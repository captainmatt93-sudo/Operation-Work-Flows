// ============================================================
// Maintenance Service — Standalone maintenance task creation
// ============================================================
const { logger } = require("firebase-functions/v2");
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const M = require("../config/maintenance");

function log(step, msg) {
  logger.info(`[MAINT Step ${step}] ${msg}`);
}

/**
 * Execute the full maintenance flow for a charter.
 *
 * @param {Object} payload - The maintPayload from Firestore
 * @param {string} payload.yachtName
 * @param {string} payload.yachtModel - e.g. "VOYAGE 510"
 * @param {string} payload.maintProjectGid - evergreen maint project for this yacht
 * @param {string} payload.checkoutProjectGid
 * @param {string} payload.maintSectionGid - "Post - Maintenance Info" section in checkout
 * @param {string} payload.charterName
 * @param {string} payload.charterNumber
 * @param {string} payload.yachtNameId - enum GID
 * @param {string} payload.yachtModelId - enum GID
 * @param {string} payload.endDate - due date for maint tasks
 * @param {string} payload.startDate
 * @param {string[]} payload.jobs - standard job subtask names
 * @param {string|null} payload.charterSection - yacht schedule section GID
 * @param {string|null} [payload.captainGid] - captain user GID (optional)
 */
async function executeMaintenanceFlow(payload) {
  const {
    yachtName,
    yachtModel: rawYachtModel,
    maintProjectGid: rawMaintProjectGid,
    checkoutProjectGid,
    maintSectionGid: rawMaintSectionGid,
    charterName,
    charterNumber,
    yachtNameId: rawYachtNameId,
    yachtModelId,
    endDate,
    startDate,
    jobs,
    charterSection: rawCharterSection,
    captainGid,
  } = payload;

  const resolvedYacht = C.resolveYachtName(yachtName);
  const fallbackMaint = M.YACHT_MAINTENANCE[yachtName] || M.YACHT_MAINTENANCE[resolvedYacht] || {};
  const maintProjectGid = rawMaintProjectGid || fallbackMaint.project || null;
  const yachtModel = rawYachtModel || C.BOAT_TO_MODEL[yachtName] || C.BOAT_TO_MODEL[resolvedYacht] || null;
  const yachtNameId = rawYachtNameId || C.YACHT_NAME_GIDS[yachtName] || C.YACHT_NAME_GIDS[resolvedYacht] || null;
  const charterSection = rawCharterSection || fallbackMaint.charterSection || null;

  if (!maintProjectGid) {
    logger.warn(`No maintenance project for yacht: ${yachtName}`);
    return { success: false, error: "No maintenance project configured" };
  }

  log(1, `Starting maintenance for ${yachtName} (${charterNumber})`);

  // ── Step 1: Determine genset type ────────────────────────────
  const fixedTasks = C.getFixedMaintTasks(yachtName, yachtModel);
  const gensetType = C.isSingleGenset(yachtName, yachtModel) ? "single" : "dual";
  log(1, `Genset type: ${gensetType} → ${fixedTasks.length} fixed tasks`);

  // ── Step 2: Look up Mechanical + Turn Around + Checkout sections concurrently ────
  log(2, "Looking up Mechanical and Turn Around sections");
  const [mechSections, maintProjSections, coSections] = await Promise.all([
    asana.getProjectSections(C.BOARDS.MECHANICAL_PROJECT),
    asana.getProjectSections(maintProjectGid),
    !rawMaintSectionGid && checkoutProjectGid
      ? asana.getProjectSections(checkoutProjectGid).catch(() => [])
      : Promise.resolve([]),
  ]);
  const maintSectionGid = rawMaintSectionGid
    || coSections.find(s => s.name && s.name.includes("Post - Maintenance"))?.gid
    || null;
  let mechSectionGid = null;
  for (const s of mechSections) {
    if (s.name && s.name.trim().startsWith("Service Due")) {
      mechSectionGid = s.gid;
      break;
    }
  }
  let turnAroundSectionGid = null;
  for (const s of maintProjSections) {
    if (s.name && s.name.trim().toLowerCase() === "turn around jobs") {
      turnAroundSectionGid = s.gid;
      break;
    }
  }
  log(2, `Mechanical: ${mechSectionGid || "NOT FOUND"}, Turn Around: ${turnAroundSectionGid || "NOT FOUND"}`);

  // ── Step 3: Common custom fields ──────────────────────────────
  const maintFields = {
    [C.CUSTOM_FIELDS.MAINT_TYPE]: C.CUSTOM_FIELDS.MAINT_PREVENTATIVE,
    [C.CUSTOM_FIELDS.YACHT_NAME]: yachtNameId,
  };
  let tasksCreated = 0;
  const allTaskGids = []; // track for Pre section linking

  // ── Step 4: Create fixed tasks with memberships (concurrent) ────
  log(4, `Creating ${fixedTasks.length} fixed tasks with memberships (parallel)`);
  const fixedResults = await Promise.all(fixedTasks.map(async (fixedTask) => {
    const memberships = [];
    memberships.push(turnAroundSectionGid
      ? { project: maintProjectGid, section: turnAroundSectionGid }
      : { project: maintProjectGid }
    );
    memberships.push(maintSectionGid
      ? { project: checkoutProjectGid, section: maintSectionGid }
      : { project: checkoutProjectGid }
    );
    if (fixedTask.dept === C.CUSTOM_FIELDS.DEPT_MECHANICAL && mechSectionGid) {
      memberships.push({ project: C.BOARDS.MECHANICAL_PROJECT, section: mechSectionGid });
    }

    const assignee = fixedTask.assignee
      || (fixedTask.dept === C.CUSTOM_FIELDS.DEPT_MECHANICAL ? C.MAINT_CREW.DAVID_ST_CLAIR
        : fixedTask.dept === C.CUSTOM_FIELDS.DEPT_RIGGING ? C.MAINT_CREW.SHERLOCK_HARTMAN
        : captainGid || null);

    const task = await asana.createTask({
      name: fixedTask.name,
      projects: memberships.map(m => m.project),
      memberships,
      assignee,
      due_on: endDate,
      custom_fields: {
        ...maintFields,
        [C.CUSTOM_FIELDS.MAINT_DEPARTMENT]: fixedTask.dept,
        [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: fixedTask.hours || null,
      },
    });
    const taskGid = task.data.gid;
    log(4, `Created: ${fixedTask.name} (${taskGid}) [assignee=${assignee || "unassigned"}]`);
    return taskGid;
  }));
  tasksCreated += fixedResults.length;
  allTaskGids.push(...fixedResults);

  // ── Step 5: Create Standard Jobs with memberships + subtasks ───────────
  log(5, "Creating Standard Jobs parent task");
  const stdMemberships = [];
  stdMemberships.push(turnAroundSectionGid
    ? { project: maintProjectGid, section: turnAroundSectionGid }
    : { project: maintProjectGid }
  );
  stdMemberships.push(maintSectionGid
    ? { project: checkoutProjectGid, section: maintSectionGid }
    : { project: checkoutProjectGid }
  );
  const stdJobsTask = await asana.createTask({
    name: "Standard Jobs",
    projects: stdMemberships.map(m => m.project),
    memberships: stdMemberships,
    assignee: captainGid || null,
    due_on: endDate,
    custom_fields: {
      ...maintFields,
      [C.CUSTOM_FIELDS.MAINT_DEPARTMENT]: C.CUSTOM_FIELDS.DEPT_GENERAL,
    },
  });
  const stdJobsGid = stdJobsTask.data.gid;
  tasksCreated++;
  allTaskGids.push(stdJobsGid);

  // Subtasks via 3 concurrent workers
  const subtaskList = jobs && jobs.length > 0 ? jobs : (fallbackMaint.jobs || []);
  await asana.createSubtasksWithWorkers(stdJobsGid, subtaskList, 3);
  const subtasksCreated = subtaskList.length;
  log(5, `Created Standard Jobs + ${subtasksCreated} subtasks`);

  // ── Step 6: Yacht Schedule board task ────────────────────────
  if (charterSection) {
    log(6, "Creating yacht schedule task");
    await asana.createTask({
      name: charterName,
      projects: [C.BOARDS.YACHT_SCHEDULE],
      start_on: startDate,
      due_on: endDate,
      custom_fields: {
        [C.CUSTOM_FIELDS.CHARTER_NUMBER]: charterNumber,
      },
    });
    tasksCreated++;
  }

  // ── Steps 7a + 7b: Bidirectional bridge — run both concurrently ─
  await Promise.all([
    // ── 7a: Backward bridge ─────────────────────────────────────
    (async () => {
      log("7a", "Looking for previous charter to pull its POST tasks into current PRE");
      try {
        const prevCharter = await db.getPreviousCharter(yachtName, startDate);
        if (!prevCharter?.checkoutProjectGid) {
          log("7a", "No previous charter found — skipping backward bridge");
          return;
        }
        log("7a", `Found previous charter: ${prevCharter.charterNumber}`);

        // Fetch both projects' sections concurrently
        const [prevSections, curSections] = await Promise.all([
          asana.getProjectSections(prevCharter.checkoutProjectGid),
          asana.getProjectSections(checkoutProjectGid),
        ]);
        const prevPostSection = prevSections.find(s => s.name?.includes("Post - Maintenance"));
        const curPreSection = curSections.find(s => s.name?.includes("Pre - Maintenance"));

        if (!prevPostSection || !curPreSection) {
          log("7a", `Section not found — prevPost: ${!!prevPostSection}, curPre: ${!!curPreSection}`);
          return;
        }

        const prevPostTasks = await asana.getSectionTasks(prevPostSection.gid);
        // Link all tasks concurrently
        await Promise.all(prevPostTasks.map(t =>
          asana.addTaskToProject(t.gid, checkoutProjectGid)
            .then(() => asana.addTaskToSection(curPreSection.gid, t.gid))
        ));
        log("7a", `Linked ${prevPostTasks.length} tasks from previous charter POST → current PRE`);
      } catch (err) {
        logger.warn(`Backward maintenance bridge failed: ${err.message}`);
      }
    })(),

    // ── 7b: Forward bridge ──────────────────────────────────────
    (async () => {
      log("7b", "Looking for next charter to push current POST tasks into its PRE");
      try {
        const nextCharter = await db.getNextCharter(yachtName, endDate);
        if (!nextCharter?.checkoutProjectGid) {
          log("7b", "No next charter found — skipping forward bridge");
          return;
        }
        log("7b", `Found next charter: ${nextCharter.charterNumber}`);

        const nextSections = await asana.getProjectSections(nextCharter.checkoutProjectGid);
        const nextPreSection = nextSections.find(s => s.name?.includes("Pre - Maintenance"));
        if (!nextPreSection) {
          log("7b", "Pre - Maintenance Info section not found on next charter");
          return;
        }

        // Clear C's PRE first — removes stale tasks from re-bridge or previous edit
        const existingPreTasks = await asana.getSectionTasks(nextPreSection.gid);
        if (existingPreTasks.length > 0) {
          await Promise.all(existingPreTasks.map(t =>
            asana.removeTaskFromProject(t.gid, nextCharter.checkoutProjectGid)
              .catch(err => logger.warn(`Clear PRE maint task ${t.gid}: ${err.message}`))
          ));
          log("7b", `Cleared ${existingPreTasks.length} stale tasks from next charter PRE`);
        }

        // Link all current POST tasks concurrently
        await Promise.all(allTaskGids.map(gid =>
          asana.addTaskToProject(gid, nextCharter.checkoutProjectGid)
            .then(() => asana.addTaskToSection(nextPreSection.gid, gid))
        ));
        log("7b", `Linked ${allTaskGids.length} tasks from current POST → next charter PRE`);
      } catch (err) {
        logger.warn(`Forward maintenance bridge failed: ${err.message}`);
      }
    })(),
  ]);

  log(8, `Maintenance complete: ${tasksCreated} tasks, ${subtasksCreated} subtasks`);
  return {
    success: true,
    tasksCreated,
    subtasksCreated,
    gensetType,
  };
}

module.exports = { executeMaintenanceFlow };
