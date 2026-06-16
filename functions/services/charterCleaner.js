// ============================================================
// Charter Cleaner — the garbage collector
// Replaces Flow 8 (Asana Website Delete)
// ============================================================
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const { logger } = require("firebase-functions/v2");

/**
 * Delete all Asana artifacts for a charter.
 * Called on "Delete" or "Edit" actions.
 *
 * @param {object} payload - { charter_name, charter_number, section }
 * @returns {{ success: boolean }}
 */
async function deleteCharter(payload) {
  const data = payload.data || payload;
  const charterNumber = data.charter_number;
  const action = data.section; // "Edit" or "Delete"
  const log = (step, msg) => logger.info(`[Delete Step ${step}] ${msg}`);

  // ── Step 1: Read provisioning state from Firestore ──────────
  log(1, `Looking up provisioning state for charter ${charterNumber}`);
  const state = await db.getProvisioningState(charterNumber);

  if (!state) {
    // Fallback: try the legacy "bridging task" approach
    logger.warn(`No Firestore state for charter ${charterNumber}, attempting legacy lookup`);
    return await legacyDelete(data);
  }

  const { charterProjectGid, checkoutProjectGid } = state;
  log(1, `Found: charter=${charterProjectGid}, checkout=${checkoutProjectGid}`);

  // ── Step 2: Delete all tasks in checkout project ────────────
  log(2, "Deleting checkout project tasks");
  try {
    const checkoutSections = await asana.getProjectSections(checkoutProjectGid);
    for (const section of checkoutSections) {
      const tasks = await asana.getSectionTasks(section.gid);
      for (const task of tasks) {
        await asana.deleteTask(task.gid);
      }
    }
  } catch (err) {
    logger.warn(`Error deleting checkout tasks: ${err.message}`);
  }

  // ── Step 3: Delete both projects ────────────────────────────
  log(3, "Deleting charter and checkout projects");
  try {
    await asana.deleteProject(charterProjectGid);
  } catch (err) {
    logger.warn(`Error deleting charter project: ${err.message}`);
  }
  try {
    await asana.deleteProject(checkoutProjectGid);
  } catch (err) {
    logger.warn(`Error deleting checkout project: ${err.message}`);
  }

  // ── Step 4: Clean up master boards ──────────────────────────
  log(4, "Cleaning up master boards");

  // Laundry Schedule
  const laundryTasks = await asana.searchTasks({
    "projects.any": C.BOARDS.LAUNDRY,
    [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber,
    "completed": false,
  });
  for (const t of laundryTasks) {
    await asana.deleteTask(t.gid);
  }

  // Yacht Schedule
  const yachtTasks = await asana.searchTasks({
    "projects.any": C.BOARDS.YACHT_SCHEDULE,
    [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber,
    "completed": false,
  });
  for (const t of yachtTasks) {
    await asana.deleteTask(t.gid);
  }

  // IN/OUT Schedule
  const inOutTasks = await asana.searchTasks({
    "projects.any": C.BOARDS.IN_OUT_SCHEDULE,
    [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber,
    "completed": false,
  });
  for (const t of inOutTasks) {
    await asana.deleteTask(t.gid);
  }

  // ── Step 5: Delete provisioning state ───────────────────────
  log(5, "Deleting provisioning state from Firestore");
  await db.deleteProvisioningState(charterNumber);

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
 * Legacy fallback: if no Firestore state exists (for charters created
 * before this system), use the old "bridging task notes" approach.
 */
async function legacyDelete(data) {
  const charterName = data.charter_name;
  const charterNumber = data.charter_number;

  logger.info(`Legacy delete: searching for bridging task for "${charterName}"`);

  // Search for the bridging task
  const bridgingResults = await asana.searchTasks({
    "teams.any": C.CHECKOUT_TEAM,
    "text": `"Check-Out | Check-In, ${charterName}"`,
    [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.contains`]: charterNumber,
  });

  if (bridgingResults.length === 0) {
    logger.error(`Legacy delete: bridging task not found for "${charterName}"`);
    return { success: false, error: "Bridging task not found" };
  }

  // Get the notes field which contains comma-separated project GIDs
  const bridgingTask = await asana.getTask(bridgingResults[0].gid, "notes");
  const projectGids = bridgingTask.data.notes.split(",").map((s) => s.trim());

  logger.info(`Legacy delete: found project GIDs: ${projectGids.join(", ")}`);

  // Delete both projects
  for (const gid of projectGids) {
    if (gid) {
      try {
        // Delete tasks in the project first
        const sections = await asana.getProjectSections(gid);
        for (const section of sections) {
          const tasks = await asana.getSectionTasks(section.gid);
          for (const task of tasks) {
            await asana.deleteTask(task.gid);
          }
        }
        await asana.deleteProject(gid);
      } catch (err) {
        logger.warn(`Legacy delete error for project ${gid}: ${err.message}`);
      }
    }
  }

  // Clean up master boards (same as modern flow)
  const boards = [C.BOARDS.LAUNDRY, C.BOARDS.YACHT_SCHEDULE, C.BOARDS.IN_OUT_SCHEDULE];
  for (const boardGid of boards) {
    const tasks = await asana.searchTasks({
      "projects.any": boardGid,
      [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber,
      "completed": false,
    });
    for (const t of tasks) {
      await asana.deleteTask(t.gid);
    }
  }

  return { success: true };
}

module.exports = { deleteCharter };
