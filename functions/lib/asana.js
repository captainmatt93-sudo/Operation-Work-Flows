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

async function asanaRequest(method, path, body = null) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const options = { method, headers: getHeaders() };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asana ${method} ${path} failed (${res.status}): ${text}`);
  }
  // DELETE returns 200 with empty body sometimes
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null;
  }
  return res.json();
}

// --- Core CRUD ---

async function createTask(data) {
  return asanaRequest("POST", "/tasks", { data });
}

async function createSubtask(parentGid, data) {
  return asanaRequest("POST", `/tasks/${parentGid}/subtasks`, { data });
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

async function duplicateProject(templateGid, name, color = null) {
  const body = {
    data: {
      name,
      include: ["members", "notes", "task_notes", "task_assignee",
                "task_subtasks", "task_attachments", "task_dates",
                "task_dependencies", "task_followers", "task_tags",
                "task_projects"],
    },
  };
  // Asana's duplicate endpoint returns a Job, not the project directly
  const result = await asanaRequest("POST", `/projects/${templateGid}/duplicate`, body);
  const job = result.data;

  // Poll the job until it completes
  let attempts = 0;
  while (attempts < 60) {
    const jobStatus = await asanaRequest("GET", `/jobs/${job.gid}`);
    if (jobStatus.data.status === "succeeded") {
      const newProjectGid = jobStatus.data.new_project?.gid
        || jobStatus.data.resource_subtype === "duplicate_project"
        && jobStatus.data.new_project_template?.gid;
      // If the job response includes the new project directly
      if (jobStatus.data.new_project) {
        return jobStatus.data.new_project;
      }
      // Otherwise fetch it from the result
      return jobStatus.data;
    }
    if (jobStatus.data.status === "failed") {
      throw new Error(`Project duplication failed: ${JSON.stringify(jobStatus.data)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
  }
  throw new Error("Project duplication timed out after 120 seconds");
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
 * Silently skips fields that are already attached.
 */
async function ensureProjectCustomFields(projectGid, fieldGids) {
  for (const gid of fieldGids) {
    try {
      await addCustomFieldToProject(projectGid, gid);
    } catch (err) {
      // 400 = already exists on project, that's fine
      if (!err.message.includes("already")) {
        // Log but don't fail
        console.warn(`Could not add custom field ${gid} to project: ${err.message}`);
      }
    }
  }
}

// --- Search ---

async function searchTasks(params) {
  const qs = new URLSearchParams(params).toString();
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
  updateTask,
  deleteTask,
  getTask,
  duplicateProject,
  getProject,
  deleteProject,
  updateProject,
  addProjectMember,
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
