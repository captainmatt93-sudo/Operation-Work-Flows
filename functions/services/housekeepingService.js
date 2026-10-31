// ============================================================
// Housekeeping Service — Standalone housekeeping task creation
// ============================================================
const { logger } = require("firebase-functions/v2");
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const M = require("../config/maintenance");

function log(step, msg) {
  logger.info(`[HK Step ${step}] ${msg}`);
}

/**
 * Execute the full housekeeping flow for a charter.
 *
 * @param {Object} payload - The hkPayload from Firestore
 * @param {string} payload.yachtName
 * @param {string} payload.checkoutProjectGid
 * @param {string} payload.hkSectionGid - "Post - House Keeping Info" section in checkout
 * @param {string} payload.charterName
 * @param {string} payload.charterNumber
 * @param {string} payload.yachtNameId - enum GID
 * @param {string} payload.yachtModelId - enum GID
 * @param {string} payload.acronym - yacht acronym (e.g. "SC")
 * @param {string} payload.clientShort - client short name
 * @param {string} payload.endDate - due date for tasks
 * @param {string} payload.boardingTimeDisplay - e.g. "12:00 PM"
 * @param {Object} payload.stageHours - { A: 5, B: 2.5, C: 2.5 }
 */
async function executeHousekeepingFlow(payload) {
  const {
    yachtName,
    checkoutProjectGid,
    hkSectionGid: rawHkSectionGid,
    charterName,
    charterNumber,
    yachtNameId: rawYachtNameId,
    yachtModelId: rawYachtModelId,
    acronym: rawAcronym,
    clientShort,
    endDate,
    startDate,
    boardingTimeDisplay,
    stageHours: rawStageHours,
  } = payload;

  const resolvedYacht = C.resolveYachtName(yachtName);
  const stageHours = rawStageHours || M.YACHT_STAGES[yachtName] || M.YACHT_STAGES[resolvedYacht] || null;
  const acronym = C.YACHT_ACRONYMS[yachtName] || C.YACHT_ACRONYMS[resolvedYacht] || rawAcronym || yachtName?.substring(0, 3);
  const yachtModel = C.BOAT_TO_MODEL[yachtName] || C.BOAT_TO_MODEL[resolvedYacht] || null;
  const yachtNameId = rawYachtNameId || C.YACHT_NAME_GIDS[yachtName] || C.YACHT_NAME_GIDS[resolvedYacht] || null;
  const yachtModelId = rawYachtModelId || (yachtModel ? C.YACHT_MODEL_IDS[yachtModel] : null) || null;

  if (!stageHours) {
    logger.warn(`No housekeeping stage hours for yacht: ${yachtName}`);
    return { success: false, error: "No housekeeping stage config" };
  }

  log(1, `Starting housekeeping for ${yachtName} (${charterNumber})`);

  // ── Step 1: Resolve evergreen HK project ─────────────────────
  const hkProjectGid = M.YACHT_HK_PROJECTS[yachtName] || M.YACHT_HK_PROJECTS[resolvedYacht] || null;
  log(1, `Evergreen HK project: ${hkProjectGid || "NOT FOUND"}`);

  // ── Step 2: Look up "Turn Around Jobs" section on HK project (+ fallback hkSectionGid) ─
  let hkTurnAroundGid = null;
  let hkSectionGid = rawHkSectionGid || null;
  const [hkProjSections, coSections] = await Promise.all([
    hkProjectGid ? asana.getProjectSections(hkProjectGid) : Promise.resolve([]),
    !hkSectionGid && checkoutProjectGid
      ? asana.getProjectSections(checkoutProjectGid).catch(() => [])
      : Promise.resolve([]),
  ]);
  if (hkProjectGid) {
    for (const s of hkProjSections) {
      if (s.name && s.name.trim().toLowerCase() === "turn around jobs") {
        hkTurnAroundGid = s.gid;
        break;
      }
    }
    log(2, `HK Turn Around Jobs section: ${hkTurnAroundGid || "NOT FOUND"}`);
  }
  if (!hkSectionGid && coSections.length > 0) {
    hkSectionGid = coSections.find(s => s.name && s.name.includes("Post - House"))?.gid || null;
  }

  // ── Step 3: Resolve yacht section on HK Yacht Schedule ───────
  const yachtScheduleSection = C.HK_YACHT_SECTIONS[yachtName] || C.HK_YACHT_SECTIONS[resolvedYacht] || null;
  log(3, `HK Yacht Schedule section: ${yachtScheduleSection || "NOT FOUND"}`);

  // Notes format for all tasks
  const notesStr = `${checkoutProjectGid} | ${charterName} | ${boardingTimeDisplay} | ${charterNumber}`;

  // Pay rate
  const payPerHour = 18.75;

  const lists = M.HOUSEKEEPING_LISTS;

  // ── Step 4: Build stage config ───────────────────────────────
  const stageConfig = [
    { label: "Interior A", intExt: "Interior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_INTERIOR, stage: "A", stageGid: C.CUSTOM_FIELDS.STAGE_A, hours: stageHours.A, items: lists.INTERIOR_A },
    { label: "Interior B", intExt: "Interior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_INTERIOR, stage: "B", stageGid: C.CUSTOM_FIELDS.STAGE_B, hours: stageHours.B, items: lists.INTERIOR_B },
    { label: "Interior C", intExt: "Interior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_INTERIOR, stage: "C", stageGid: C.CUSTOM_FIELDS.STAGE_C, hours: stageHours.C, items: lists.INTERIOR_C },
    { label: "Exterior A", intExt: "Exterior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_EXTERIOR, stage: "A", stageGid: C.CUSTOM_FIELDS.STAGE_A, hours: stageHours.A, items: lists.EXTERIOR_A },
    { label: "Exterior B", intExt: "Exterior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_EXTERIOR, stage: "B", stageGid: C.CUSTOM_FIELDS.STAGE_B, hours: stageHours.B, items: lists.EXTERIOR_B },
    { label: "Exterior C", intExt: "Exterior", intExtGid: C.CUSTOM_FIELDS.INT_EXT_EXTERIOR, stage: "C", stageGid: C.CUSTOM_FIELDS.STAGE_C, hours: stageHours.C, items: lists.EXTERIOR_C },
  ];

  // ── Step 5: Create HK parent tasks with memberships (concurrent, 2 groups of 3) ────
  log(5, `Creating ${stageConfig.length} HK stages with memberships (parallel)`);

  function buildParentPayload(stage) {
    const taskName = `${acronym} | ${clientShort}, ${stage.label}`;
    const stageSectionGid = C.HK_STAGE_SECTIONS[stage.stage];
    const memberships = [];
    memberships.push(yachtScheduleSection
      ? { project: C.BOARDS.HK_YACHT_SCHEDULE, section: yachtScheduleSection }
      : { project: C.BOARDS.HK_YACHT_SCHEDULE }
    );
    memberships.push(hkSectionGid
      ? { project: checkoutProjectGid, section: hkSectionGid }
      : { project: checkoutProjectGid }
    );
    if (stageSectionGid) {
      memberships.push({ project: C.BOARDS.HK_STAGE_PROJECT, section: stageSectionGid });
    }
    if (hkProjectGid) {
      memberships.push(hkTurnAroundGid
        ? { project: hkProjectGid, section: hkTurnAroundGid }
        : { project: hkProjectGid }
      );
    }
    return {
      taskName,
      payload: {
        name: taskName,
        projects: memberships.map(m => m.project),
        memberships,
        due_on: endDate,
        notes: notesStr,
        custom_fields: {
          [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: stage.hours,
          [C.CUSTOM_FIELDS.CLEANING_STAGE]: stage.stageGid,
          [C.CUSTOM_FIELDS.INT_EXT]: stage.intExtGid,
          [C.CUSTOM_FIELDS.YACHT_NAME]: yachtNameId,
          [C.CUSTOM_FIELDS.YACHT_MODEL]: yachtModelId || null,
        },
      },
    };
  }

  // Create all 6 parent tasks concurrently (1500 RPM — safe headroom)
  const parentTasks = await Promise.all(stageConfig.map(async (stage) => {
    const { taskName, payload } = buildParentPayload(stage);
    const result = await asana.createTask(payload);
    const gid = result.data.gid;
    log(5, `Created: ${taskName} (${gid})`);
    return { gid, stage, taskName };
  }));

  // ── Step 5b: Create subtasks — 2 stages at a time to avoid overwhelming Asana ────
  const totalSubtasks = parentTasks.reduce((sum, p) => sum + p.stage.items.length, 0);
  log("5b", `Creating ${totalSubtasks} subtasks across ${parentTasks.length} stages (sequential, batch 10/call)`);
  for (const p of parentTasks) {
    await asana.batchCreateSubtasks(p.gid, p.stage.items);
    log("5b", `Done: "${p.taskName}" (${p.stage.items.length} items)`);
  }
  const stageResults = parentTasks.map(p => ({ parentGid: p.gid, subtaskCount: p.stage.items.length }));
  log("5b", "All subtasks created");

  // Collect results
  const tasksCreated = stageResults.length;
  const subtasksCreated = stageResults.reduce((sum, r) => sum + r.subtaskCount, 0);
  const allTaskGids = stageResults.map(r => r.parentGid);

  // ── Steps 7a + 7b: Bidirectional bridge — run both concurrently ─
  // 7a: pull PREVIOUS charter POST tasks → CURRENT PRE
  // 7b: push CURRENT POST tasks → NEXT charter PRE
  await Promise.all([
    // ── 7a: Backward bridge ─────────────────────────────────────
    (async () => {
      log("7a", "Looking for previous charter to pull its POST HK tasks into current PRE");
      try {
        const prevCharter = await db.getPreviousCharter(yachtName, startDate || endDate);
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
        const prevPostSection = prevSections.find(s => s.name?.includes("Post - House"));
        const curPreSection  = curSections.find(s => s.name?.includes("Pre - House"));

        if (!prevPostSection || !curPreSection) {
          log("7a", `Section not found — prevPost: ${!!prevPostSection}, curPre: ${!!curPreSection}`);
          return;
        }

        const prevPostTasks = await asana.getSectionTasks(prevPostSection.gid);
        // Link all tasks concurrently (addProject must precede addSection per task)
        await Promise.all(prevPostTasks.map(t =>
          asana.addTaskToProject(t.gid, checkoutProjectGid)
            .then(() => asana.addTaskToSection(curPreSection.gid, t.gid))
        ));
        log("7a", `Linked ${prevPostTasks.length} tasks from previous charter POST → current PRE`);
      } catch (err) {
        logger.warn(`Backward HK bridge failed: ${err.message}`);
      }
    })(),

    // ── 7b: Forward bridge ──────────────────────────────────────
    (async () => {
      log("7b", "Looking for next charter to push current POST HK tasks into its PRE");
      try {
        const nextCharter = await db.getNextCharter(yachtName, endDate);
        if (!nextCharter?.checkoutProjectGid) {
          log("7b", "No next charter found — skipping forward bridge");
          return;
        }
        log("7b", `Found next charter: ${nextCharter.charterNumber}`);

        const nextSections = await asana.getProjectSections(nextCharter.checkoutProjectGid);
        const nextPreSection = nextSections.find(s => s.name?.includes("Pre - House"));
        if (!nextPreSection) {
          log("7b", "Pre - House Keeping Info section not found on next charter");
          return;
        }

        // Clear C's PRE-HK first — removes stale tasks from re-bridge or previous edit.
        // removeTaskFromProject only (NOT delete) — tasks survive in their home projects.
        const existingPreTasks = await asana.getSectionTasks(nextPreSection.gid);
        if (existingPreTasks.length > 0) {
          await Promise.all(existingPreTasks.map(t =>
            asana.removeTaskFromProject(t.gid, nextCharter.checkoutProjectGid)
              .catch(err => logger.warn(`Clear PRE HK task ${t.gid}: ${err.message}`))
          ));
          log("7b", `Cleared ${existingPreTasks.length} stale tasks from next charter PRE-HK`);
        }

        // Link all current POST tasks concurrently into clean PRE
        await Promise.all(allTaskGids.map(gid =>
          asana.addTaskToProject(gid, nextCharter.checkoutProjectGid)
            .then(() => asana.addTaskToSection(nextPreSection.gid, gid))
        ));
        log("7b", `Linked ${allTaskGids.length} tasks from current POST → next charter PRE`);

      } catch (err) {
        logger.warn(`Forward HK bridge failed: ${err.message}`);
      }
    })(),
  ]);

  log(8, `Housekeeping complete: ${tasksCreated} tasks, ${subtasksCreated} subtasks`);
  return {
    success: true,
    tasksCreated,
    subtasksCreated,
  };
}

module.exports = { executeHousekeepingFlow };
