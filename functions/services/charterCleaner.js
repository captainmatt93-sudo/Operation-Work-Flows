// ============================================================
// Charter Cleaner — the garbage collector
// Replaces Flow 8 (Asana Website Delete)
// ============================================================
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const { logger } = require("firebase-functions/v2");

// Sections WE OWN — tasks are deleted globally (Asana cascades subtasks)
const CHECKOUT_POST_SECTIONS = [
  "Post - Maintenance Info",
  "Post - House Keeping Info",
  "Check-In | Check-Out",
];

// Sections with tasks BORROWED from adjacent charters — only remove from this project,
// never delete globally (those tasks belong to the neighboring charter)
const CHECKOUT_PRE_SECTIONS = [
  "Pre - House Keeping Info",
  "Pre - Maintenance Info",
];

/** Normalize a section name for fuzzy matching (lowercase, strip hyphens & extra spaces) */
function norm(s) { return (s || "").toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim(); }

/**
 * Delete all Asana artifacts for a charter.
 * Called on "Delete" or "Edit" actions.
 *
 * Logic:
 *  1. Look up charterProjectGid + checkoutProjectGid from Firestore (or legacy bridging task)
 *  2. Charter project   → delete ALL tasks → delete project
 *  3. Checkout project  → delete tasks only from owned sections → delete project
 *  4. Clean up Firestore state
 *  5. If Edit → HubSpot callback
 *
 * @param {object} payload - full charter payload with at minimum charter_number + charter_name
 */
async function deleteCharter(payload) {
  const data = payload.data || payload;
  const charterNumber = data.charter_number;
  const action = data.section; // "Edit" or "Delete"
  const log = (step, msg) => logger.info(`[Delete Step ${step}] ${msg}`);

  // ── Step 1: Resolve project GIDs ────────────────────────────
  log(1, `Resolving project GIDs for charter ${charterNumber}`);
  let charterProjectGid = null;
  let checkoutProjectGid = null;

  const state = await db.getProvisioningState(charterNumber);
  if (state) {
    charterProjectGid  = state.charterProjectGid;
    checkoutProjectGid = state.checkoutProjectGid;
    log(1, `Firestore hit: charter=${charterProjectGid}, checkout=${checkoutProjectGid}`);
  } else {
    // Legacy fallback — find via bridging task notes field (by charter_name or charter_number)
    logger.warn(`No Firestore state for ${charterNumber}, falling back to bridging task lookup`);
    const rawCharterName = data.charter_name && !data.charter_name.startsWith("undefined |")
      ? data.charter_name
      : null;

    let bridgingResults = [];

    if (rawCharterName) {
      bridgingResults = await asana.searchTasks({
        "teams.any": C.CHECKOUT_TEAM,
        "text": `"Check-Out | Check-In, ${rawCharterName}"`,
      });
    }

    // Fallback 1b: Search by CHARTER_NUMBER custom field if text search missed or charter_name was omitted
    if (bridgingResults.length === 0 && charterNumber) {
      bridgingResults = await asana.searchTasks({
        "text": `"Check-Out | Check-In"`,
        [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber,
      }).catch(() => []);
    }

    if (bridgingResults.length === 0) {
      logger.error(`Bridging task not found for charter=${charterNumber} name="${rawCharterName || ""}"`);
      return { success: false, error: "Bridging task not found" };
    }

    const bridgingTask = await asana.getTask(bridgingResults[0].gid, "notes");
    const gids = (bridgingTask.data?.notes || "").split(",").map(s => s.trim()).filter(Boolean);
    if (gids.length < 2) {
      return { success: false, error: `Unexpected bridging task notes format: ${bridgingTask.data?.notes}` };
    }
    // notes format: "checkoutProjectGid, charterProjectGid"
    checkoutProjectGid = gids[0];
    charterProjectGid  = gids[1];
    log(1, `Legacy lookup: charter=${charterProjectGid}, checkout=${checkoutProjectGid}`);
  }

  // ── Steps 2+3: Unlink borrowed PRE tasks from checkout ────────────────────
  log("2", `Unlinking borrowed PRE tasks from checkout`);
  await unlinkPreTasksFromCheckout(checkoutProjectGid, log);

  // ── Step 2b: Globally delete POST tasks (maint + HK) ───────────────────────
  // These tasks are multi-project members (also in evergreen maint/HK projects).
  // Deleting the checkout project alone only removes the membership — they survive.
  // We must globally delete them BEFORE deleting the projects.
  log("2b", `Globally deleting POST-Maint and POST-HK tasks`);
  await deletePostTasksFromCheckout(checkoutProjectGid, log);

  // ── Step 2c: Delete IN/OUT DEPARTURE + ARRIVAL tasks ───────────────────────
  // These live only on the IN_OUT_SCHEDULE board (not multi-project),
  // but they are NOT inside either project so project deletion won't cascade them.
  if (state?.depTaskGid || state?.arrTaskGid) {
    log("2c", `Deleting IN/OUT tasks: dep=${state.depTaskGid} arr=${state.arrTaskGid}`);
    await Promise.all([
      state.depTaskGid
        ? asana.deleteTask(state.depTaskGid).catch(err => logger.warn(`Delete dep task: ${err.message}`))
        : Promise.resolve(),
      state.arrTaskGid
        ? asana.deleteTask(state.arrTaskGid).catch(err => logger.warn(`Delete arr task: ${err.message}`))
        : Promise.resolve(),
    ]);
  }

  // ── Step 3: Delete all tasks inside the charter project ──────────
  // Asana's DELETE /projects only removes the project container — tasks survive
  // as orphans. We must explicitly delete every task before removing the project.
  log(3, "Deleting all tasks inside the charter project");
  await deleteAllProjectTasks(charterProjectGid, log);

  // ── Step 4: Delete charter/checkout projects + Charter Info tracking task ───
  // All three fire concurrently — none depends on the others.
  log(4, "Deleting charter project, checkout project, and Charter Info tracking task");
  await Promise.all([
    asana.deleteProject(charterProjectGid).catch(err => logger.warn(`Charter project delete: ${err.message}`)),
    asana.deleteProject(checkoutProjectGid).catch(err => logger.warn(`Checkout project delete: ${err.message}`)),
    state?.trackingTaskGid
      ? asana.deleteTask(state.trackingTaskGid).catch(err => logger.warn(`Charter Info tracking task delete: ${err.message}`))
      : Promise.resolve(),
  ]);

  // ── Step 5: Delete Firestore state ────────────────────────────────
  log(5, "Deleting provisioning state from Firestore");
  await db.deleteProvisioningState(charterNumber).catch(() => {});

  // ── Step 5b: Re-bridge adjacent charters (heal the gap) ────────────────
  if (state) {
    await rebridgeAdjacentCharters(state, log).catch(err =>
      logger.warn(`Re-bridge failed (non-fatal): ${err.message}`)
    );
  }

  // ── Step 6: HubSpot callback (Edit only) ────────────────────
  if (action === "Edit") {
    log(6, "Sending HubSpot callback");
    try {
      await fetch("https://hubspot-v1-y7dob2qvta-uk.a.us-east4.run.app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charter_number: charterNumber, success: true }),
      });
    } catch (err) {
      logger.error(`HubSpot callback failed: ${err.message}`);
    }
  }

  log("✓", `Charter ${charterNumber} fully deleted`);
  return { success: true };
}

/**
 * After deleting charter B (which sat between charter A and charter C),
 * link charter A's POST-HK and POST-Maint tasks into charter C's PRE sections.
 * This heals the gap so the next charter still has the correct handover context.
 */
async function rebridgeAdjacentCharters(deletedState, log) {
  const { yachtName, startDate, endDate } = deletedState;

  const [prevCharter, nextCharter] = await Promise.all([
    db.getPreviousCharter(yachtName, startDate),
    db.getNextCharter(yachtName, endDate),
  ]);

  if (!prevCharter || !nextCharter) {
    log("rebridge", `No re-bridge needed — prev=${!!prevCharter} next=${!!nextCharter}`);
    return;
  }

  log("rebridge", `Healing gap: ${prevCharter.charterNumber} → ${nextCharter.charterNumber}`);

  const prevMap = prevCharter.sectionMap || {};
  const nextMap = nextCharter.sectionMap || {};

  // HK: prev POST → next PRE
  const prevPostHk   = prevMap["Post - House-Keeping Info"] || prevMap["Post - House Keeping Info"];
  const nextPreHk    = nextMap["Pre - House-Keeping Info"] || nextMap["Pre - House Keeping Info"];
  // Maint: prev POST → next PRE
  const prevPostMaint = prevMap["Post - Maintenance Info"];
  const nextPreMaint  = nextMap["Pre - Maintenance Info"];

  await Promise.all([
    (async () => {
      if (!prevPostHk || !nextPreHk) return;
      const tasks = await asana.getSectionTasks(prevPostHk);
      await Promise.all(
        tasks.map(t =>
          asana.addTaskToSection(nextPreHk, t.gid)
            .catch(err => logger.warn(`Re-bridge HK task ${t.gid}: ${err.message}`))
        )
      );
      log("rebridge", `Linked ${tasks.length} HK tasks → ${nextCharter.charterNumber} PRE-HK`);
    })(),
    (async () => {
      if (!prevPostMaint || !nextPreMaint) return;
      const tasks = await asana.getSectionTasks(prevPostMaint);
      await Promise.all(
        tasks.map(t =>
          asana.addTaskToSection(nextPreMaint, t.gid)
            .catch(err => logger.warn(`Re-bridge Maint task ${t.gid}: ${err.message}`))
        )
      );
      log("rebridge", `Linked ${tasks.length} Maint tasks → ${nextCharter.charterNumber} PRE-Maint`);
    })(),
  ]);
}

/**
 * In the checkout project, only UNLINK tasks from borrowed (PRE) sections.
 * We do NOT individually delete POST section tasks — deleting the project cascades them.
 * PRE section tasks belong to adjacent charters and must only be removed from this
 * project membership, never globally deleted.
 */
async function unlinkPreTasksFromCheckout(checkoutProjectGid, log) {
  try {
    const sections = await asana.getProjectSections(checkoutProjectGid);
    const preSections = sections.filter(s =>
      CHECKOUT_PRE_SECTIONS.some(name => norm(s.name).includes(norm(name)))
    );
    const preLists = await Promise.all(preSections.map(s => asana.getSectionTasks(s.gid)));
    const preTasks = preLists.flat();
    if (log) log(3, `Checkout PRE: ${preSections.length} sections, ${preTasks.length} borrowed tasks to unlink`);
    await Promise.all(
      preTasks.map(t =>
        asana.removeTaskFromProject(t.gid, checkoutProjectGid)
          .catch(err => logger.warn(`Unlink pre-task ${t.gid}: ${err.message}`))
      )
    );
  } catch (err) {
    logger.warn(`unlinkPreTasksFromCheckout(${checkoutProjectGid}): ${err.message}`);
  }
}


/**
 * Globally delete all tasks in POST-Maint and POST-HK sections.
 * These tasks are multi-project members (also in evergreen maint/HK projects),
 * so project deletion alone leaves them behind. Must run BEFORE project deletion.
 * Deletes in batches of 3 with 300ms between batches to respect Asana rate limits.
 */
async function deletePostTasksFromCheckout(checkoutProjectGid, log) {
  const BATCH_SIZE = 3;
  const DELAY_MS   = 300;
  try {
    const sections = await asana.getProjectSections(checkoutProjectGid);
    const postSections = sections.filter(s =>
      CHECKOUT_POST_SECTIONS.some(name => norm(s.name).includes(norm(name)))
    );
    const taskLists = await Promise.all(postSections.map(s => asana.getSectionTasks(s.gid)));
    const tasks = taskLists.flat();
    if (log) log("2b", `Found ${tasks.length} POST tasks to globally delete across ${postSections.length} sections`);

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(t =>
          asana.deleteTask(t.gid)
            .catch(err => logger.warn(`Delete POST task ${t.gid}: ${err.message}`))
        )
      );
      if (i + BATCH_SIZE < tasks.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }
  } catch (err) {
    logger.warn(`deletePostTasksFromCheckout(${checkoutProjectGid}): ${err.message}`);
  }
}

/**
 * Delete ALL tasks inside a project.
 * Asana's DELETE /projects only removes the container — tasks survive as orphans.
 * Gets every section, collects every task, deletes in batches of 3.
 */
async function deleteAllProjectTasks(projectGid, log) {
  const BATCH_SIZE = 3;
  try {
    const sections = await asana.getProjectSections(projectGid);
    const taskLists = await Promise.all(sections.map(s => asana.getSectionTasks(s.gid)));
    const tasks = taskLists.flat();
    if (log) log(3, `Found ${tasks.length} tasks across ${sections.length} sections to delete`);

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(t =>
          asana.deleteTask(t.gid)
            .catch(err => logger.warn(`Delete charter task ${t.gid}: ${err.message}`))
        )
      );
    }
  } catch (err) {
    logger.warn(`deleteAllProjectTasks(${projectGid}): ${err.message}`);
  }
}

module.exports = { deleteCharter };
