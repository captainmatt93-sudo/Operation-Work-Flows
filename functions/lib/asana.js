// ============================================================
// Asana REST API Service — single wrapper for all Asana interactions
// ============================================================
const { ASANA_WORKSPACE } = require("../config/constants");

const BASE_URL = "https://app.asana.com/api/1.0";

function getHeaders() {
  const token = process.env.ASANA_PAT;
  if (!token) throw new Error("ASANA_PAT environment variable is not set");
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ── Write semaphore — Asana caps concurrent POST/PUT/PATCH/DELETE at 15 ──
// We cap at 12 to leave headroom and avoid queueing/throttling.
const WRITE_CONCURRENCY = 12;
let activeWrites = 0;
const writeQueue = [];

function acquireWriteSlot() {
  if (activeWrites < WRITE_CONCURRENCY) {
    activeWrites++;
    return Promise.resolve();
  }
  return new Promise(resolve => writeQueue.push(resolve));
}

function releaseWriteSlot() {
  if (writeQueue.length > 0) {
    const next = writeQueue.shift();
    next(); // don't decrement — slot transfers to next waiter
  } else {
    activeWrites--;
  }
}

async function asanaRequest(method, path, body = null, retries = 3) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const options = { method, headers: getHeaders() };
  if (body) options.body = JSON.stringify(body);

  const isWrite = method !== "GET";
  if (isWrite) await acquireWriteSlot();

  try {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await fetch(url, options);

      // Rate limited — back off and retry
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "1", 10);
        const waitMs = (retryAfter * 1000) || (attempt * 1000);
        console.warn(`[RATE] Asana 429 on ${method} ${path} — Retry-After ${retryAfter}s (attempt ${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // Transient Asana 5xx error (e.g. 502/503/504) — back off and retry
      if (res.status >= 500 && res.status < 600 && attempt < retries) {
        const waitMs = attempt * 1500;
        console.warn(`[RETRY] Asana ${res.status} on ${method} ${path} — retrying in ${waitMs}ms (attempt ${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        console.error(`Asana ${method} ${path} failed (${res.status}): ${text}`);
        if (body) console.error(`Request body: ${JSON.stringify(body).substring(0, 500)}`);
        throw new Error(`Asana ${method} ${path} failed (${res.status}): ${text}`);
      }
      // DELETE returns 200 with empty body sometimes
      if (res.status === 204 || res.headers.get("content-length") === "0") {
        return null;
      }
      return res.json();
    }

    throw new Error(`Asana ${method} ${path} failed after ${retries} retries (rate limited)`);
  } finally {
    if (isWrite) releaseWriteSlot();
  }
}

// --- Core CRUD ---

async function createTask(data) {
  return asanaRequest("POST", "/tasks", { data });
}

async function createSubtask(parentGid, data) {
  return asanaRequest("POST", `/tasks/${parentGid}/subtasks`, { data });
}

/**
 * Create multiple subtasks using a worker-pool of individual POST requests.
 * Used by maintenance (small subtask lists ~3 items).
 */
async function createSubtasksWithWorkers(parentGid, items, workers = 3) {
  const queue = [...items];
  async function drain() {
    while (queue.length) {
      const name = queue.shift();
      await asanaRequest("POST", `/tasks/${parentGid}/subtasks`, { data: { name } });
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, drain));
}

/**
 * Create multiple subtasks using the Asana Batch API.
 * 10 subtasks per batch call — 181 items = 19 calls instead of 181.
 * Used by housekeeping (large subtask lists).
 */
async function batchCreateSubtasks(parentGid, items) {
  const BATCH_SIZE = 10;
  const DELAY_MS = 500;
  const MAX_RETRIES = 3;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const actions = chunk.map(name => ({
      method: "POST",
      relative_path: `/tasks/${parentGid}/subtasks`,
      data: { name },
    }));

    // Retry each batch up to MAX_RETRIES times
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await asanaRequest("POST", "/batch", { data: { actions } });
        break; // success — move to next batch
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err; // give up after final attempt
        const backoff = attempt * 2000; // 2s, 4s
        console.warn(`[BATCH] Subtask batch failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoff}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
}


/**
 * Create tasks in specific sections using the Batch API.
 * Each task is created with a memberships field (project + section) so no
 * separate addTaskToSection call is needed. Batched 10 per request to avoid
 * burst 429s that carry a 120s retry-after penalty.
 *
 * @param {Array<{name, projectGid, sectionGid, sectionName, extraFields}>} taskDefs
 * @returns {Array<{taskGid, sectionName}>}
 */
async function batchCreateTasksInSections(taskDefs) {
  const BATCH_SIZE = 10;
  const DELAY_MS = 300;
  const results = [];

  for (let i = 0; i < taskDefs.length; i += BATCH_SIZE) {
    const chunk = taskDefs.slice(i, i + BATCH_SIZE);

    const actions = chunk.map(def => ({
      method: "POST",
      relative_path: "/tasks",
      data: {
        name: def.name,
        memberships: [{ project: def.projectGid, section: def.sectionGid }],
        ...(def.extraFields || {}),
      },
    }));

    const response = await asanaRequest("POST", "/batch", { data: { actions } });

    // Batch response: response.data[j].body.data.gid
    for (let j = 0; j < chunk.length; j++) {
      const taskGid = response?.data?.[j]?.body?.data?.gid || null;
      results.push({ taskGid, sectionName: chunk[j].sectionName });
    }

    if (i + BATCH_SIZE < taskDefs.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return results;
}


async function updateTask(taskGid, data) {
  return asanaRequest("PUT", `/tasks/${taskGid}`, { data });
}

async function deleteTask(taskGid) {
  return asanaRequest("DELETE", `/tasks/${taskGid}`);
}

async function getTask(taskGid, optFields = "") {
  const qs = optFields ? `?opt_fields=${optFields}` : "";
  return asanaRequest("GET", `/tasks/${taskGid}${qs}`);
}

// --- Projects ---

async function duplicateProject(templateGid, name) {
  const body = {
    data: {
      name,
      include: ["members", "notes", "task_notes", "task_assignee",
                "task_subtasks", "task_dates", "task_dependencies",
                "task_projects"],
    },
  };
  // Asana returns a Job object whose new_project.gid is allocated immediately.
  // We grab the GID from the initial response — no polling needed.
  // The orchestrator waits a flat 10s before reading sections/tasks.
  const result = await asanaRequest("POST", `/projects/${templateGid}/duplicate`, body);
  const job = result.data;

  const newProjectGid = job.new_project?.gid;
  if (!newProjectGid) {
    throw new Error(`duplicateProject: no new_project.gid in job response: ${JSON.stringify(job)}`);
  }
  return { gid: newProjectGid };
}

async function getProject(projectGid) {
  return asanaRequest("GET", `/projects/${projectGid}`);
}

async function deleteProject(projectGid) {
  return asanaRequest("DELETE", `/projects/${projectGid}`);
}

async function updateProject(projectGid, data) {
  return asanaRequest("PUT", `/projects/${projectGid}`, { data });
}

async function addProjectMember(projectGid, memberGid) {
  return asanaRequest("POST", `/projects/${projectGid}/addMembers`, {
    data: { members: [memberGid] },
  });
}

async function addProjectMembers(projectGid, memberGids) {
  return asanaRequest("POST", `/projects/${projectGid}/addMembers`, {
    data: { members: memberGids },
  });
}

async function getWorkspaceUsers() {
  const result = await asanaRequest("GET", `/workspaces/${ASANA_WORKSPACE}/users?opt_fields=gid`);
  return result.data.map(u => u.gid);
}

// --- Sections ---

async function getProjectSections(projectGid) {
  const result = await asanaRequest("GET", `/projects/${projectGid}/sections`);
  return result.data;
}

async function getSectionTasks(sectionGid, optFields = "") {
  const qs = optFields ? `?opt_fields=${optFields}` : "";
  const result = await asanaRequest("GET", `/sections/${sectionGid}/tasks${qs}`);
  return result.data;
}

async function addTaskToSection(sectionGid, taskGid) {
  return asanaRequest("POST", `/sections/${sectionGid}/addTask`, {
    data: { task: taskGid },
  });
}

async function addCustomFieldToProject(projectGid, customFieldGid) {
  return asanaRequest("POST", `/projects/${projectGid}/addCustomFieldSetting`, {
    data: { custom_field: customFieldGid },
  });
}

/**
 * Ensure a set of custom fields are attached to a project.
 * Skips fields that are already attached. Retries on failure.
 */
async function ensureProjectCustomFields(projectGid, fieldGids) {
  await Promise.all(fieldGids.map(async (gid) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await addCustomFieldToProject(projectGid, gid);
        return;
      } catch (err) {
        if (err.message.includes("already") || err.message.includes("Custom field is already")) return;
        console.warn(`Attempt ${attempt}/3: Could not add custom field ${gid} — ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }));
}


// --- Search ---

async function searchTasks(params) {
  // Strip null/undefined values — Asana rejects them as literal strings in URL params
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null)
  );
  const qs = new URLSearchParams(clean).toString();
  const result = await asanaRequest(
    "GET",
    `/workspaces/${ASANA_WORKSPACE}/tasks/search?${qs}`
  );
  return result.data;
}

// --- Task linking ---

async function addTaskToProject(taskGid, projectGid) {
  return asanaRequest("POST", `/tasks/${taskGid}/addProject`, {
    data: { project: projectGid },
  });
}

async function removeTaskFromProject(taskGid, projectGid) {
  return asanaRequest("POST", `/tasks/${taskGid}/removeProject`, {
    data: { project: projectGid },
  });
}

// --- Batch helper (creates tasks sequentially to avoid rate limits) ---

async function batchCreateTasks(tasksArray) {
  const results = [];
  for (const taskData of tasksArray) {
    const result = await createTask(taskData);
    results.push(result);
    // Small delay to respect Asana rate limits (150 req/min)
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

module.exports = {
  createTask,
  createSubtask,
  createSubtasksWithWorkers,
  batchCreateSubtasks,
  batchCreateTasksInSections,
  updateTask,
  deleteTask,
  getTask,
  duplicateProject,
  getProject,
  deleteProject,
  updateProject,
  addProjectMember,
  addProjectMembers,
  getWorkspaceUsers,
  getProjectSections,
  getSectionTasks,
  addTaskToSection,
  searchTasks,
  addTaskToProject,
  removeTaskFromProject,
  batchCreateTasks,
  addCustomFieldToProject,
  ensureProjectCustomFields,
};
