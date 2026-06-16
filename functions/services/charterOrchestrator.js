// ============================================================
// Charter Orchestrator — the heart of the system
// Replaces Flows 1-7 in a single sequential execution
// ============================================================
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const M = require("../config/maintenance");
const { logger } = require("firebase-functions/v2");

/**
 * Main orchestration function for creating a new charter.
 * Executes steps 1-15 sequentially.
 */
async function orchestrateNewCharter(payload) {
  const data = payload.data || payload;
  const log = (step, msg) => logger.info(`[Step ${step}] ${msg}`);

  // ── Step 1: Validate dates ──────────────────────────────────
  log(1, "Validating charter dates");
  const startDate = new Date(data.start_date || data.start_on);
  const endDate = new Date(data.end_date || data.due_on);

  if (startDate > endDate) {
    const brokerEmail = C.BROKERS[data.broker_name] || "matt@voyagecharters.com";
    logger.error(`Date validation failed: start ${startDate} > end ${endDate}. Broker: ${brokerEmail}`);
    // TODO: Send error email via your email service
    return { success: false, error: "Start date is after end date", brokerEmail };
  }

  // ── Step 2: Resolve crew GIDs ───────────────────────────────
  log(2, "Resolving Captain and Chef GIDs");
  const captainGid = data.captain ? (C.CAPTAINS[data.captain] || null) : null;
  const chefGid = data.chef ? (C.CHEFS[data.chef] || null) : null;
  log(2, `Captain: ${data.captain} → ${captainGid}, Chef: ${data.chef} → ${chefGid}`);

  // ── Step 3: Create tracking task in Asana ───────────────────
  log(3, "Creating tracking task in Asana");
  const charterName = `${data.yacht_name} | ${data.client_name} | ${data.start_date} | ${data.end_date}`;
  const trackingTask = await asana.createTask({
    name: charterName,
    projects: [C.BOARDS.CHARTER_INFO],
    custom_fields: {
      [C.CUSTOM_FIELDS.YACHT_NAME]: data.yacht_name_id,
      [C.CUSTOM_FIELDS.CHARTER_TYPE]: data.charter_type_id,
      [C.CUSTOM_FIELDS.START_DATE]: data.start_date,
      [C.CUSTOM_FIELDS.END_DATE]: data.end_date,
      [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      [C.CUSTOM_FIELDS.NUMBER_OF_GUESTS]: data.number_guests,
      [C.CUSTOM_FIELDS.START_DAY]: data.start_day_id,
      [C.CUSTOM_FIELDS.END_DAY]: data.end_day_id,
    },
  });
  const trackingTaskGid = trackingTask.data.gid;
  log(3, `Tracking task created: ${trackingTaskGid}`);

  // ── Step 4-5: Look up template and duplicate project ────────
  log(4, `Looking up charter template for type: ${data.charter_type}`);
  const template = C.CHARTER_TEMPLATES[data.charter_type];
  if (!template) {
    throw new Error(`Unknown charter type: ${data.charter_type}`);
  }

  log(5, `Duplicating template ${template.gid} as "${charterName}"`);
  const newProject = await asana.duplicateProject(template.gid, charterName, template.color);
  const charterProjectGid = newProject.gid || newProject.new_project?.gid;
  log(5, `Charter project created: ${charterProjectGid}`);

  // Update project color
  if (template.color) {
    await asana.updateProject(charterProjectGid, { color: template.color });
  }

  // ── Step 6: Create charter-named task in each section ───────
  log(6, "Creating tasks in project sections");
  const sections = await asana.getProjectSections(charterProjectGid);
  const sectionCount = Math.min(sections.length, 12);
  for (let i = 0; i < sectionCount; i++) {
    await asana.createTask({
      name: charterName,
      projects: [charterProjectGid],
    });
    await asana.addTaskToSection(sections[i].gid, trackingTaskGid);
  }

  // ── Step 7: Add editor + update Charter Info task ───────────
  log(7, "Setting permissions and updating Charter Info");
  await asana.addProjectMember(charterProjectGid, C.EDITOR_MEMBER);

  // Find the Charter Info task (section index 2)
  if (sections.length > 2) {
    const charterInfoTasks = await asana.getSectionTasks(sections[2].gid);
    if (charterInfoTasks.length > 0) {
      await asana.updateTask(charterInfoTasks[0].gid, {
        custom_fields: {
          [C.CUSTOM_FIELDS.YACHT_NAME]: data.yacht_name_id,
          [C.CUSTOM_FIELDS.CHARTER_TYPE]: data.charter_type_id,
          [C.CUSTOM_FIELDS.START_DATE]: data.start_date,
          [C.CUSTOM_FIELDS.END_DATE]: data.end_date,
          [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
          [C.CUSTOM_FIELDS.NUMBER_OF_GUESTS]: data.number_guests,
          [C.CUSTOM_FIELDS.CHARTER_PRICE]: data.charter_price,
          [C.CUSTOM_FIELDS.CONTACT_EMAIL]: data.contact_email,
        },
      });
    }
  }

  // ── Step 8: Update centralized tracking boards ──────────────
  log(8, "Updating centralized tracking boards");
  // Charter Info board
  const charterInfoResults = await asana.searchTasks({
    "projects.any": C.BOARDS.CHARTER_INFO,
    "text": `"${charterName}"`,
  });
  if (charterInfoResults.length > 0) {
    await asana.updateTask(charterInfoResults[0].gid, {
      start_on: data.start_date,
      due_on: data.end_date,
    });
  }
  // Arrivals board
  const arrivalResults = await asana.searchTasks({
    "projects.any": C.BOARDS.ARRIVALS,
    "text": `"${charterName}"`,
  });
  if (arrivalResults.length > 0) {
    await asana.updateTask(arrivalResults[0].gid, { due_on: data.start_date });
  }
  // Departures board
  const departureResults = await asana.searchTasks({
    "projects.any": C.BOARDS.DEPARTURES,
    "text": `"${charterName}"`,
  });
  if (departureResults.length > 0) {
    await asana.updateTask(departureResults[0].gid, { due_on: data.end_date });
  }

  // ── Step 9-10: Checkout project duplication + bridging task ─
  log(9, "Duplicating checkout template");
  const yachtName = data.yacht_name?.trim();
  const checkoutTemplateGid = C.CHECKOUT_TEMPLATES[yachtName]
    || C.CHECKOUT_TEMPLATES["default"];

  const checkoutName = `Check-Out | Check-In, ${charterName}`;
  const checkoutProject = await asana.duplicateProject(checkoutTemplateGid, checkoutName);
  const checkoutProjectGid = checkoutProject.gid || checkoutProject.new_project?.gid;
  log(10, `Checkout project created: ${checkoutProjectGid}`);

  // Create bridging task linked to both projects
  const bridgingTask = await asana.createTask({
    name: `Check-Out | Check-In, ${charterName}`,
    projects: [charterProjectGid, checkoutProjectGid],
    notes: `${charterProjectGid},${checkoutProjectGid}`,
  });
  log(10, `Bridging task created: ${bridgingTask.data.gid}`);

  // Add editor to checkout project
  await asana.addProjectMember(checkoutProjectGid, C.EDITOR_MEMBER);

  // ── Step 11: Save provisioning state to Firestore ───────────
  log(11, "Saving provisioning state to Firestore");
  await db.saveProvisioningState(data.charter_number, {
    charterNumber: data.charter_number,
    charterName,
    charterProjectGid,
    checkoutProjectGid,
    bridgingTaskGid: bridgingTask.data.gid,
    yachtName,
    trackingTaskGid,
  });

  // ── Step 12: Create maintenance tasks ───────────────────────
  log(12, "Creating maintenance tasks");
  await createMaintenanceTasks(yachtName, checkoutProjectGid, charterName, data);

  // ── Step 13: Create housekeeping checklists ─────────────────
  log(13, "Creating housekeeping checklists");
  await createHousekeepingChecklists(yachtName, checkoutProjectGid, charterName, data);

  // ── Step 14: IN/OUT Schedule ────────────────────────────────
  log(14, "Updating IN/OUT Schedule");
  await createInOutSchedule(data, charterProjectGid);

  // ── Step 15: Back-to-back detection ─────────────────────────
  log(15, "Checking for back-to-back charters");
  await detectBackToBack(data, charterProjectGid, charterName);

  log("✓", `Charter orchestration complete for ${charterName}`);
  return {
    success: true,
    charterProjectGid,
    checkoutProjectGid,
    charterName,
  };
}

/**
 * Step 14: Create DEPARTURE and ARRIVAL tasks on the IN/OUT board.
 * Search ±30 days for same yacht. Calculate turnaround. Sort by day-of-week.
 */
async function createInOutSchedule(data, charterProjectGid) {
  const startDate = data.start_date || data.start_on;
  const endDate = data.end_date || data.due_on;

  // Create DEPARTURE task
  const depTask = await asana.createTask({
    name: `${data.client_name} | ${data.yacht_name} | ${data.boarding_time?.display || ""} | - DEPARTURE`,
    projects: [C.BOARDS.IN_OUT_SCHEDULE],
    due_on: startDate,
    notes: `Current Charter: https://app.asana.com/0/${charterProjectGid}`,
    custom_fields: {
      [C.CUSTOM_FIELDS.IN_OUT_TYPE]: C.CUSTOM_FIELDS.IN_OUT_DEPARTURE,
      [C.CUSTOM_FIELDS.YACHT_NAME]: data.yacht_name_id,
      [C.CUSTOM_FIELDS.CHARTER_TYPE]: data.charter_type_id,
      [C.CUSTOM_FIELDS.START_DATE]: startDate,
      [C.CUSTOM_FIELDS.END_DATE]: endDate,
      [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      [C.CUSTOM_FIELDS.START_DAY]: data.start_day_id,
      [C.CUSTOM_FIELDS.END_DAY]: data.end_day_id,
    },
  });

  // Search for closest departures within ±30 days (same yacht)
  const thirtyBefore = addDays(endDate, -30);
  const thirtyAfter = addDays(endDate, 30);

  const nearbyDepartures = await asana.searchTasks({
    "projects.any": C.BOARDS.IN_OUT_SCHEDULE,
    "due_on.before": thirtyAfter,
    "due_on.after": thirtyBefore,
    [`custom_fields.${C.CUSTOM_FIELDS.YACHT_NAME}.value`]: data.yacht_name_id,
    [`custom_fields.${C.CUSTOM_FIELDS.IN_OUT_TYPE}.value`]: C.CUSTOM_FIELDS.IN_OUT_DEPARTURE,
    "opt_fields": "name,due_on",
  });

  // Find closest next departure (turnaround calculation)
  let closestDays = 10000;
  for (const dep of nearbyDepartures) {
    if (!dep.due_on) continue;
    const diff = daysBetween(endDate, dep.due_on);
    if (diff >= 0 && diff < closestDays) {
      closestDays = diff;
    }
  }

  // Create ARRIVAL task
  const useAltArrival = closestDays <= 1;
  const arrTask = await asana.createTask({
    name: `${data.client_name} | ${data.yacht_name} - ARRIVAL`,
    projects: [C.BOARDS.IN_OUT_SCHEDULE],
    due_on: endDate,
    notes: `Current Charter: https://app.asana.com/0/${charterProjectGid}`,
    custom_fields: {
      [C.CUSTOM_FIELDS.IN_OUT_TYPE]: useAltArrival
        ? C.CUSTOM_FIELDS.IN_OUT_ARRIVAL_ALT
        : C.CUSTOM_FIELDS.IN_OUT_ARRIVAL,
      [C.CUSTOM_FIELDS.YACHT_NAME]: data.yacht_name_id,
      [C.CUSTOM_FIELDS.CHARTER_TYPE]: data.charter_type_id,
      [C.CUSTOM_FIELDS.START_DATE]: startDate,
      [C.CUSTOM_FIELDS.END_DATE]: endDate,
      [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      [C.CUSTOM_FIELDS.TURNAROUND_DAYS]: closestDays < 10000 ? closestDays : null,
      [C.CUSTOM_FIELDS.START_DAY]: data.start_day_id,
      [C.CUSTOM_FIELDS.END_DAY]: data.end_day_id,
    },
  });

  // Sort DEPARTURE into correct day-of-week section
  const startDay = data.start_day?.trim();
  if (startDay && C.DAY_SECTIONS[startDay]) {
    await asana.addTaskToSection(C.DAY_SECTIONS[startDay], depTask.data.gid);
  }

  // Sort ARRIVAL into correct day-of-week section
  const endDay = data.end_day?.trim();
  if (endDay && C.DAY_SECTIONS[endDay]) {
    await asana.addTaskToSection(C.DAY_SECTIONS[endDay], arrTask.data.gid);
  }
}

/**
 * Step 15: Search for adjacent charters on the same yacht.
 * If gap ≤ 3 days, create a debrief task and cross-link projects.
 */
async function detectBackToBack(data, currentProjectGid, charterName) {
  const yachtName = data.yacht_name?.trim();
  const startDate = data.start_date || data.start_on;
  const endDate = data.end_date || data.due_on;

  // Search all projects in the Check-Out team for the same yacht
  const allProjects = await asana.searchTasks({
    "projects.any": C.BOARDS.CHARTER_INFO,
    [`custom_fields.${C.CUSTOM_FIELDS.YACHT_NAME}.value`]: data.yacht_name_id,
    "opt_fields": "name,start_on,due_on",
  });

  let closestPrev = null;
  let closestPrevDays = 10000;
  let closestNext = null;
  let closestNextDays = 10000;

  for (const proj of allProjects) {
    if (!proj.due_on || !proj.start_on) continue;

    // Days between current start and this charter's end (previous charter)
    const prevDiff = daysBetween(proj.due_on, startDate);
    if (prevDiff >= 0 && prevDiff < closestPrevDays) {
      closestPrevDays = prevDiff;
      closestPrev = proj;
    }

    // Days between current end and this charter's start (next charter)
    const nextDiff = daysBetween(endDate, proj.start_on);
    if (nextDiff >= 0 && nextDiff < closestNextDays) {
      closestNextDays = nextDiff;
      closestNext = proj;
    }
  }

  // If adjacent charter is within 3 days, create debrief task
  if (closestPrevDays <= 3 && closestPrev) {
    logger.info(`Back-to-back detected with previous charter (${closestPrevDays} days): ${closestPrev.name}`);
    await asana.createTask({
      name: `Pass on ${data.client_name} Debrief`,
      projects: [currentProjectGid],
      notes: `Previous charter: ${closestPrev.name}\nGap: ${closestPrevDays} day(s)`,
    });
  }

  if (closestNextDays <= 3 && closestNext) {
    logger.info(`Back-to-back detected with next charter (${closestNextDays} days): ${closestNext.name}`);
    await asana.createTask({
      name: `Pass on ${data.client_name} Debrief`,
      projects: [currentProjectGid],
      notes: `Next charter: ${closestNext.name}\nGap: ${closestNextDays} day(s)`,
    });
  }
}

/**
 * Step 12: Create maintenance tasks in the yacht's existing maintenance project.
 * Also links them into the checkout project.
 */
async function createMaintenanceTasks(yachtName, checkoutProjectGid, charterName, data) {
  const yachtConfig = M.YACHT_MAINTENANCE[yachtName];
  if (!yachtConfig) {
    logger.warn(`No maintenance config for yacht: ${yachtName}`);
    return;
  }

  const { project: maintProjectGid, jobs, charterSection } = yachtConfig;
  logger.info(`Creating ${jobs.length} maintenance jobs in project ${maintProjectGid}`);

  // Get the sections of the maintenance project
  const maintSections = await asana.getProjectSections(maintProjectGid);
  // Section[1] is typically where new tasks go
  const targetSectionGid = maintSections.length > 1 ? maintSections[1].gid : maintSections[0].gid;

  for (const jobName of jobs) {
    const task = await asana.createTask({
      name: `${jobName} - ${charterName}`,
      projects: [maintProjectGid],
    });
    // Also add to the checkout project so crews see it there
    await asana.addTaskToProject(task.data.gid, checkoutProjectGid);
    await asana.addTaskToSection(targetSectionGid, task.data.gid);
  }

  // Update the yacht schedule board if we have a charter section
  if (charterSection) {
    await asana.createTask({
      name: charterName,
      projects: [C.BOARDS.YACHT_SCHEDULE],
      start_on: data.start_date,
      due_on: data.end_date,
      custom_fields: {
        [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      },
    });
  }
}

/**
 * Step 13: Create housekeeping checklists with stage-based parent tasks
 * and subtask checklists under each.
 */
async function createHousekeepingChecklists(yachtName, checkoutProjectGid, charterName, data) {
  const stages = M.YACHT_STAGES[yachtName];
  if (!stages) {
    logger.warn(`No housekeeping stages for yacht: ${yachtName}`);
    return;
  }

  const lists = M.HOUSEKEEPING_LISTS;

  // Get checkout project sections
  const sections = await asana.getProjectSections(checkoutProjectGid);

  // Stage definitions: parent task name → { hours, checklist }
  const stageConfig = [
    { name: `Interior Stage A - ${stages.A} hours`, items: lists.INTERIOR_A },
    { name: `Interior Stage B - ${stages.B} hours`, items: lists.INTERIOR_B },
    { name: `Interior Stage C - ${stages.C} hours`, items: lists.INTERIOR_C },
    { name: `Exterior Stage A - ${stages.A} hours`, items: lists.EXTERIOR_A },
    { name: `Exterior Stage B - ${stages.B} hours`, items: lists.EXTERIOR_B },
    { name: `Exterior Stage C - ${stages.C} hours`, items: lists.EXTERIOR_C },
  ];

  for (const stage of stageConfig) {
    // Create parent task
    const parentTask = await asana.createTask({
      name: stage.name,
      projects: [checkoutProjectGid],
      notes: `Charter: ${charterName}\nYacht: ${yachtName}`,
    });
    const parentGid = parentTask.data.gid;

    // Create subtasks under the parent
    for (const item of stage.items) {
      await asana.createSubtask(parentGid, { name: item });
      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 150));
    }

    logger.info(`Created ${stage.items.length} subtasks under "${stage.name}"`);
  }
}

// ── Date helpers ─────────────────────────────────────────────

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]; // yyyy-MM-dd
}

module.exports = { orchestrateNewCharter };
