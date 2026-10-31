// ============================================================
// Charter Orchestrator — the heart of the system
// Replaces Flows 1-7 in a single parallel execution
// ============================================================
const asana = require("../lib/asana");
const db = require("../lib/firestore");
const C = require("../config/constants");
const M = require("../config/maintenance");
const { logger } = require("firebase-functions/v2");

/**
 * Main orchestration function for creating a new charter.
 * Structured into 3 parallel groups (A→B→C) to minimize total wall-clock time.
 *
 * GROUP A: tracking task + charter project duplicate + checkout project duplicate (all concurrent)
 * GROUP B: section tasks + tracking boards + checkout sections/members (all concurrent)
 * GROUP C: permissions + bridging task + schedule tasks + IN/OUT + back-to-back (all concurrent)
 */
async function orchestrateNewCharter(payload) {
  const data = payload.data || payload;
  const log = (step, msg) => logger.info(`[Step ${step}] ${msg}`);

  // ── Steps 1-2: Validate + resolve (pure JS, no API) ────────
  log(1, "Validating charter dates");
  const startDate = new Date(data.start_date || data.start_on);
  const endDate   = new Date(data.end_date   || data.due_on);
  if (startDate > endDate) {
    const brokerEmail = C.BROKERS[data.broker_name] || "matt@voyagecharters.com";
    logger.error(`Date validation failed: start ${startDate} > end ${endDate}. Broker: ${brokerEmail}`);
    // TODO: Send error email via your email service
    return { success: false, error: "Start date is after end date", brokerEmail };
  }

  log(2, "Resolving Captain and Chef GIDs");
  const captainGid = data.captain ? (C.CAPTAINS[data.captain] || null) : null;
  const chefGid    = data.chef    ? (C.CHEFS[data.chef]       || null) : null;
  log(2, `Captain: ${data.captain} → ${captainGid}, Chef: ${data.chef} → ${chefGid}`);

  // Pre-compute all constants (pure JS — no API calls)
  const charterName     = data.charter_name || `${data.yacht_name} | ${data.client_name} | ${data.start_date} | ${data.end_date}`;
  const yachtName       = data.yacht_name?.trim();
  const resolvedYacht   = C.resolveYachtName(yachtName);
  const acronym         = C.YACHT_ACRONYMS[yachtName] || C.YACHT_ACRONYMS[resolvedYacht] || yachtName.substring(0, 3);
  const yachtModel      = data.yacht_model || C.BOAT_TO_MODEL[yachtName] || C.BOAT_TO_MODEL[resolvedYacht] || null;
  const checkoutName    = `Check-Out | Check-In, ${charterName}`;
  const boardingDisplay = (data.boarding_time?.display || data.boarding_time_display || "12:00 PM").trim();
  const is5pmBoarding   = boardingDisplay.includes("5:00") || boardingDisplay.includes("5:30");

  // ── Enum ID resolution — callers may send name strings or GIDs ──────────────
  // Each field: use the explicit *_id if provided, else resolve from the name map.
  const charterTypeId   = data.charter_type_id   || C.CHARTER_TYPE_IDS[data.charter_type?.trim()]   || null;
  const salesAgentId    = data.sales_agent_id    || C.SALES_AGENT_IDS[data.sales_agent?.trim()]     || null;
  const yachtNameId     = data.yacht_name_id     || C.YACHT_NAME_GIDS[yachtName] || C.YACHT_NAME_GIDS[resolvedYacht] || null;
  const yachtModelId    = data.yacht_model_id    || C.YACHT_MODEL_IDS[yachtModel]                   || null;
  const boardingTimeGid = data.boarding_time?.gid || data.boarding_time_gid || C.BOARDING_TIME_IDS[boardingDisplay] || null;

  // Template lookups (pure JS)
  const template = C.CHARTER_TEMPLATES[data.charter_type];
  if (!template) throw new Error(`Unknown charter type: ${data.charter_type}`);
  const checkoutTemplateGid = C.CHECKOUT_TEMPLATES[yachtModel] || C.CHECKOUT_TEMPLATES["default"];
  log(4, `Charter template: ${template.gid} | Checkout template: ${checkoutTemplateGid}`);

  // ══════════════════════════════════════════════════════════════
  // GROUP A — tracking task + both project duplications
  // All three are independent and each takes ~8-12s.
  // Running concurrently saves ~12-15s vs sequential.
  // ══════════════════════════════════════════════════════════════
  log("A", "Group A — tracking task + charter project + checkout project (concurrent)");
  const [trackingTaskResult, charterProjectGid, checkoutProjectGid] = await Promise.all([

    // Step 3: Create tracking task on Charter Info board
    asana.createTask({
      name: charterName,
      projects: [C.BOARDS.CHARTER_INFO],
      custom_fields: {
        [C.CUSTOM_FIELDS.YACHT_NAME]:       yachtNameId,
        [C.CUSTOM_FIELDS.CHARTER_TYPE]:     charterTypeId,
        [C.CUSTOM_FIELDS.START_DATE]:       data.start_date,
        [C.CUSTOM_FIELDS.END_DATE]:         data.end_date,
        [C.CUSTOM_FIELDS.CHARTER_NUMBER]:   data.charter_number,
        [C.CUSTOM_FIELDS.NUMBER_OF_GUESTS]: data.number_of_guests ? String(data.number_of_guests) : null,
        [C.CUSTOM_FIELDS.START_DAY]:        data.start_day || null,
        [C.CUSTOM_FIELDS.END_DAY]:          data.end_day   || null,
      },
    }),

    // Steps 4-5: Duplicate charter project from template
    (async () => {
      log(5, `Duplicating charter template ${template.gid} as "${charterName}"`);
      const newProject = await asana.duplicateProject(template.gid, charterName, template.color);
      const gid = newProject.gid || newProject.new_project?.gid;
      log(5, `Charter project created: ${gid}`);
      return gid;
    })(),

    // Step 9: Duplicate checkout project from template
    (async () => {
      log(9, `Duplicating checkout template ${checkoutTemplateGid} as "${checkoutName}"`);
      const checkoutProject = await asana.duplicateProject(checkoutTemplateGid, checkoutName);
      const gid = checkoutProject.gid || checkoutProject.new_project?.gid;
      log(9, `Checkout project created: ${gid}`);
      return gid;
    })(),
  ]);
  const trackingTaskGid = trackingTaskResult.data.gid;
  log(3, `Tracking task created: ${trackingTaskGid}`);

  // Asana populates the duplicated project sections/tasks asynchronously.
  // Poll until the charter project has real named sections (not just "Untitled Section").
  // Retry every 5s up to 40s before falling through with whatever is available.
  log("A→B", "Polling for charter project sections to be populated...");
  let charterSectionPoll = [];
  for (let attempt = 1; attempt <= 8; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    charterSectionPoll = await asana.getProjectSections(charterProjectGid);
    const named = charterSectionPoll.filter(s => s.name && s.name.toLowerCase() !== "untitled section");
    log("A→B", `Poll ${attempt}/8: ${named.length} named sections found`);
    if (named.length >= 3) break; // enough sections present — proceed
  }

  // ══════════════════════════════════════════════════════════════
  // GROUP B — all calls that need Group A IDs (concurrent)
  // Section tasks, tracking board updates, checkout setup.
  // ══════════════════════════════════════════════════════════════
  log("B", "Group B — section tasks + tracking boards + checkout setup (concurrent)");
  const [{ charterSections, charterInfoTaskGid }, , { sectionMap }] = await Promise.all([

    // Steps 5b + 6: Get charter sections + update color + create section tasks concurrently
    (async () => {
      const [charterSections] = await Promise.all([
        Promise.resolve(charterSectionPoll), // already fetched by poll above
        template.color
          ? asana.updateProject(charterProjectGid, { color: template.color })
          : Promise.resolve(),
      ]);
      // Direct createTask calls per section (batch API silently drops memberships tasks)
      const filteredSections = charterSections.filter(
        s => s.name && s.name.toLowerCase() !== "untitled section"
      );
      log(6, `Found ${filteredSections.length} named charter sections to populate`);
      const sectionTaskResults = [];
      for (const section of filteredSections) {
        try {
          const task = await asana.createTask({
            name: charterName,
            projects: [charterProjectGid],
            memberships: [{ project: charterProjectGid, section: section.gid }],
          });
          sectionTaskResults.push({ taskGid: task?.data?.gid || null, sectionName: section.name });
        } catch (err) {
          logger.warn(`Section task create failed for ${section.name}: ${err.message}`);
          sectionTaskResults.push({ taskGid: null, sectionName: section.name });
        }
        await new Promise(r => setTimeout(r, 150));
      }
      let charterInfoTaskGid = null;
      for (const { taskGid, sectionName } of sectionTaskResults) {
        if (sectionName.toLowerCase().includes("charter info")) {
          charterInfoTaskGid = taskGid;
        }
      }

      log(6, `Section tasks created — charterInfoTaskGid: ${charterInfoTaskGid}`);
      return { charterSections, charterInfoTaskGid };
    })(),

    // Step 8: Update tracking boards — 3 searches + updates in parallel
    // .catch() handles stale GIDs after Edit-delete (search can return deleted task GIDs)
    (async () => {
      log(8, "Updating centralized tracking boards");
      await Promise.all([
        asana.searchTasks({ "projects.any": C.BOARDS.CHARTER_INFO, "text": `"${charterName}"` })
          .then(r => r.length > 0 ? asana.updateTask(r[0].gid, { start_on: data.start_date, due_on: data.end_date }) : null)
          .catch(err => log(8, `Charter Info board update skipped: ${err.message}`)),
        asana.searchTasks({ "projects.any": C.BOARDS.ARRIVALS, "text": `"${charterName}"` })
          .then(r => r.length > 0 ? asana.updateTask(r[0].gid, { due_on: data.start_date }) : null)
          .catch(err => log(8, `Arrivals board update skipped: ${err.message}`)),
        asana.searchTasks({ "projects.any": C.BOARDS.DEPARTURES, "text": `"${charterName}"` })
          .then(r => r.length > 0 ? asana.updateTask(r[0].gid, { due_on: data.end_date }) : null)
          .catch(err => log(8, `Departures board update skipped: ${err.message}`)),
      ]);
    })(),

    // Steps 10a + 10b: Get checkout sections + add member (concurrent)
    (async () => {
      // TEST MODE: Only adding Matt Nelson to avoid notifying the whole team
      // TODO: Restore to getWorkspaceUsers() for production
      const TEST_MEMBER_GID_CO = "143158124817167"; // Matthew Nelson
      const [coSections] = await Promise.all([
        asana.getProjectSections(checkoutProjectGid),
        asana.addProjectMember(checkoutProjectGid, TEST_MEMBER_GID_CO)
          .catch(err => logger.warn(`Could not add member to checkout: ${err.message}`)),
      ]);
      const sectionMap = {};
      for (const s of coSections) sectionMap[s.name] = s.gid;
      log(10, `Found ${coSections.length} checkout sections: ${Object.keys(sectionMap).join(", ")}`);
      return { sectionMap };
    })(),
  ]);

  // Pre-compute schedule task definitions (pure JS — no API)
  const scheduleProjects    = [checkoutProjectGid, C.BOARDS.CHECKOUT_MASTER];
  const coCheckInSection    = sectionMap["Check-In | Check-Out"] || null;
  const masterSection       = C.BOARDS.CHECKOUT_MASTER_SECTION;
  const scheduleMemberships = [];
  if (coCheckInSection) scheduleMemberships.push({ project: checkoutProjectGid, section: coCheckInSection });
  scheduleMemberships.push({ project: C.BOARDS.CHECKOUT_MASTER, section: masterSection });

  const scheduleFieldsBase = {
    [C.CUSTOM_FIELDS.YACHT_MODEL]:    yachtModelId,
    [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
    [C.CUSTOM_FIELDS.CHARTER_TYPE]:   charterTypeId,
  };

  const scheduleTasks = [];
  if (is5pmBoarding) {
    scheduleTasks.push({
      name: `${acronym}, Sleep Aboard`, due_on: data.start_date, notes: "0.5",
      custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_SLEEP_ABOARD, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_SLEEP, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 0.5 },
    });
    scheduleTasks.push({
      name: `${acronym}, Vessel Prep`, due_on: data.start_date, notes: "1",
      custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_VESSEL_PREP, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_STANDARD, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 1 },
    });
    scheduleTasks.push({
      name: `${acronym}, Morning Briefing`, due_on: addDays(data.start_date, 1), notes: "2",
      custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_BRIEFING, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_MORNING, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 2 },
    });
  } else {
    scheduleTasks.push({
      name: `${acronym}, Vessel Prep`, due_on: addDays(data.start_date, -1), notes: "1",
      custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_VESSEL_PREP, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_STANDARD, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 1 },
    });
    scheduleTasks.push({
      name: `${acronym}, Noon Briefing`, due_on: data.start_date, notes: "2",
      custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_BRIEFING, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_NOON, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 2 },
    });
  }
  scheduleTasks.push({
    name: `${acronym}, Debrief`, due_on: data.end_date, notes: "1.25",
    custom_fields: { ...scheduleFieldsBase, [C.CUSTOM_FIELDS.BOAT_TYPE]: C.CUSTOM_FIELDS.BOAT_TYPE_DEBRIEF, [C.CUSTOM_FIELDS.SCHEDULE_TYPE]: C.CUSTOM_FIELDS.SCHEDULE_TYPE_STANDARD, [C.CUSTOM_FIELDS.PRESCRIBED_TIME]: 1.25 },
  });

  // ══════════════════════════════════════════════════════════════
  // GROUP C — all calls that need Groups A + B IDs (concurrent)
  // Permissions, bridging task, schedule tasks, IN/OUT, back-to-back.
  // ══════════════════════════════════════════════════════════════
  log("C", "Group C — permissions + bridging + schedule + IN/OUT + back-to-back (concurrent)");
  const [, bridgingTaskGid, , inOutResult] = await Promise.all([

    // Step 7: Add charter project member + update Charter Info task
    (async () => {
      // TEST MODE: Only adding Matt Nelson to avoid notifying the whole team
      // TODO: Restore to getWorkspaceUsers() for production
      const TEST_MEMBER_GID = "143158124817167"; // Matthew Nelson
      await asana.addProjectMember(charterProjectGid, TEST_MEMBER_GID)
        .catch(err => logger.warn(`Could not add editor member: ${err.message}`));
      if (charterInfoTaskGid) {
        await asana.ensureProjectCustomFields(charterProjectGid, [
          C.CUSTOM_FIELDS.YACHT_MODEL,
          C.CUSTOM_FIELDS.SALES_AGENT,
          C.CUSTOM_FIELDS.NUMBER_OF_NIGHTS,
          C.CUSTOM_FIELDS.CONTACT_PHONE,
        ]);

        const customFieldsPayload = {
          [C.CUSTOM_FIELDS.YACHT_NAME]:       yachtNameId,
          [C.CUSTOM_FIELDS.CHARTER_TYPE]:     charterTypeId,
          [C.CUSTOM_FIELDS.START_DATE]:       data.start_date,
          [C.CUSTOM_FIELDS.END_DATE]:         data.end_date,
          [C.CUSTOM_FIELDS.CHARTER_NUMBER]:   data.charter_number,
          [C.CUSTOM_FIELDS.NUMBER_OF_GUESTS]: data.number_of_guests,
          [C.CUSTOM_FIELDS.CHARTER_PRICE]:    data.charter_price,
          [C.CUSTOM_FIELDS.CONTACT_EMAIL]:    data.contact_email,
          [C.CUSTOM_FIELDS.ACCOUNT_NAME]:     data.contact_name || data.client_name,
          [C.CUSTOM_FIELDS.CLIENT_NAME]:      data.contact_name || data.client_name,
          [C.CUSTOM_FIELDS.BOARDING_TIME]:    boardingTimeGid,
          [C.CUSTOM_FIELDS.START_DAY]:        data.start_day || null,
          [C.CUSTOM_FIELDS.END_DAY]:          data.end_day   || null,
          [C.CUSTOM_FIELDS.YACHT_MODEL]:      yachtModelId,
          [C.CUSTOM_FIELDS.SALES_AGENT]:      salesAgentId,
          [C.CUSTOM_FIELDS.NUMBER_OF_NIGHTS]: data.number_of_nights || null,
          [C.CUSTOM_FIELDS.CONTACT_PHONE]:    data.contact_phone || null,
        };

        // Guard against Asana template async custom-field attachment lag
        for (let cfAttempt = 1; cfAttempt <= 3; cfAttempt++) {
          try {
            await asana.updateTask(charterInfoTaskGid, {
              start_on: data.start_date,
              due_on:   data.end_date,
              custom_fields: customFieldsPayload,
            });
            break;
          } catch (err) {
            const match = err.message.match(/Custom field with ID (\d+) is not on given object/);
            if (match && cfAttempt < 3) {
              const missingFieldGid = match[1];
              logger.warn(`Step 7: Custom field ${missingFieldGid} not yet on project ${charterProjectGid}, attaching and retrying...`);
              try {
                await asana.addCustomFieldToProject(charterProjectGid, missingFieldGid);
                await new Promise(r => setTimeout(r, 1000));
              } catch {
                delete customFieldsPayload[missingFieldGid];
              }
            } else if (match) {
              delete customFieldsPayload[match[1]];
              await asana.updateTask(charterInfoTaskGid, {
                start_on: data.start_date,
                due_on:   data.end_date,
                custom_fields: customFieldsPayload,
              }).catch(e => logger.warn(`Step 7 fallback update warning: ${e.message}`));
              break;
            } else {
              throw err;
            }
          }
        }
      }
      log(7, "Permissions set and Charter Info task updated");
    })(),

    // Step 10c: Create bridging task + move into Check-In/Check-Out section
    (async () => {
      log(10, "Creating bridging task");
      const bridgingTask = await asana.createTask({
        name:     `Check-Out | Check-In, ${charterName}`,
        projects: [charterProjectGid, checkoutProjectGid],
        start_on: data.start_date,
        due_on:   data.end_date,
        notes:    `${checkoutProjectGid}, ${charterProjectGid}`,
        custom_fields: {
          [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
          [C.CUSTOM_FIELDS.CONTACT_ID]:     data.contact_id || "",
        },
      });
      const bridgingTaskGid = bridgingTask.data.gid;
      const checkInOutSection = charterSections.find(s => s.name.toLowerCase().includes("check"));
      if (checkInOutSection) {
        await asana.addTaskToSection(checkInOutSection.gid, bridgingTaskGid);
        log(10, `Bridging task moved to "${checkInOutSection.name}"`);
      }
      return bridgingTaskGid;
    })(),

    // Step 10d: Create all schedule tasks concurrently
    (async () => {
      log(10, `Creating ${scheduleTasks.length} schedule tasks concurrently`);
      await Promise.all(scheduleTasks.map(st =>
        asana.createTask({ ...st, projects: scheduleProjects, memberships: scheduleMemberships })
          .then(() => log(10, `Schedule task created: ${st.name}`))
      ));
    })(),

    // Step 14: IN/OUT schedule tasks + section sort
    createInOutSchedule(data, charterProjectGid, yachtNameId, charterTypeId),

    // Step 15: Back-to-back charter detection
    detectBackToBack(data, checkoutProjectGid, charterName, sectionMap, yachtNameId),
  ]);

  // Extract IN/OUT task GIDs from createInOutSchedule result (index 3)
  const depTaskGid = inOutResult?.depTaskGid || null;
  const arrTaskGid = inOutResult?.arrTaskGid || null;

  // ── Step 11: Save provisioning state to Firestore ───────────
  log(11, "Saving provisioning state to Firestore");
  const yachtConfig = M.YACHT_MAINTENANCE[yachtName] || M.YACHT_MAINTENANCE[resolvedYacht] || {};
  const stageHours  = M.YACHT_STAGES[yachtName] || M.YACHT_STAGES[resolvedYacht] || null;
  const nameParts   = charterName.split(" | ");
  const clientShort = nameParts.length > 1 ? nameParts[1] : data.client_name || "";

  const maintPayload = {
    yachtName,
    yachtModel,
    maintProjectGid: yachtConfig.project || null,
    checkoutProjectGid,
    maintSectionGid: sectionMap["Post - Maintenance Info"] || null,
    charterName,
    charterNumber:   data.charter_number,
    yachtNameId:     yachtNameId || null,
    yachtModelId:    yachtModelId || null,
    captainGid:      captainGid || null,
    endDate:         data.end_date,
    startDate:       data.start_date,
    jobs:            yachtConfig.jobs || [],
    charterSection:  yachtConfig.charterSection || null,
  };

  const hkPayload = {
    yachtName,
    checkoutProjectGid,
    hkSectionGid:        sectionMap["Post - House-Keeping Info"] ||
                         sectionMap["Post - House Keeping Info"] ||
                         Object.entries(sectionMap).find(([k]) => k.startsWith("Post -") && k.toLowerCase().includes("house"))?.[1] ||
                         null,
    charterName,
    charterNumber:       data.charter_number,
    yachtNameId:         yachtNameId || null,
    yachtModelId:        yachtModelId || null,
    acronym,
    clientShort,
    startDate:           data.start_date,
    endDate:             data.end_date,
    boardingTimeDisplay: data.boarding_time?.display || data.boarding_time_display || "",
    stageHours:          stageHours || null,
  };

  await db.saveProvisioningState(data.charter_number, {
    charterNumber:    data.charter_number,
    charterName,
    charterProjectGid,
    checkoutProjectGid,
    bridgingTaskGid,
    yachtName,
    startDate:        data.start_date,
    endDate:          data.end_date,
    trackingTaskGid,
    depTaskGid,
    arrTaskGid,
    sectionMap,
    maintPayload,
    hkPayload,
  });

  log(12, "Maintenance payload prepared (not triggered)");
  log(13, "Housekeeping payload prepared (not triggered)");
  log("✓", `Charter orchestration complete for ${charterName}`);
  return {
    success: true,
    charterProjectGid,
    checkoutProjectGid,
    charterName,
    maintPayload,
    hkPayload,
  };
}

/**
 * Step 14: Create DEPARTURE and ARRIVAL tasks on the IN/OUT board.
 * Search ±30 days for same yacht. Calculate turnaround. Sort by day-of-week.
 */
async function createInOutSchedule(data, charterProjectGid, yachtNameId, charterTypeId) {
  const startDate = data.start_date || data.start_on;
  const endDate = data.end_date || data.due_on;
  const boardingDisplay  = data.boarding_time?.display || data.boarding_time_display || "";
  const boardingTimeGid  = data.boarding_time?.gid || data.boarding_time_gid || C.BOARDING_TIME_IDS[boardingDisplay] || null;

  // Create DEPARTURE task
  const depTask = await asana.createTask({
    name: `${data.client_name} | ${data.yacht_name} | ${boardingDisplay} | - DEPARTURE`,
    projects: [C.BOARDS.IN_OUT_SCHEDULE],
    due_on: startDate,
    notes: `Current Charter: https://app.asana.com/0/${charterProjectGid}`,
    custom_fields: {
      [C.CUSTOM_FIELDS.IN_OUT_TYPE]: C.CUSTOM_FIELDS.IN_OUT_DEPARTURE,
      [C.CUSTOM_FIELDS.YACHT_NAME]: yachtNameId,
      [C.CUSTOM_FIELDS.CHARTER_TYPE]: charterTypeId,
      [C.CUSTOM_FIELDS.START_DATE]: startDate,
      [C.CUSTOM_FIELDS.END_DATE]: endDate,
      [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      [C.CUSTOM_FIELDS.START_DAY]: data.start_day || null,
      [C.CUSTOM_FIELDS.END_DAY]: data.end_day || null,
      [C.CUSTOM_FIELDS.BOARDING_TIME]: boardingTimeGid,
    },
  });

  // Search for closest departures within ±30 days (same yacht)
  const thirtyBefore = addDays(endDate, -30);
  const thirtyAfter = addDays(endDate, 30);
  const effectiveYachtId = yachtNameId || data.yacht_name_id || null;
  const resolvedYacht = C.resolveYachtName(data.yacht_name);
  const yachtVariants = C.getYachtNameVariants(data.yacht_name).map(v => v.toLowerCase());

  const nearbyDepartures = await asana.searchTasks({
    "projects.any": C.BOARDS.IN_OUT_SCHEDULE,
    "due_on.before": thirtyAfter,
    "due_on.after": thirtyBefore,
    ...(effectiveYachtId
      ? { [`custom_fields.${C.CUSTOM_FIELDS.YACHT_NAME}.value`]: effectiveYachtId }
      : { text: `"${resolvedYacht}"` }),
    [`custom_fields.${C.CUSTOM_FIELDS.IN_OUT_TYPE}.value`]: C.CUSTOM_FIELDS.IN_OUT_DEPARTURE,
    "opt_fields": "name,due_on",
  });

  // Find closest next departure (turnaround calculation)
  let closestDays = 10000;
  for (const dep of nearbyDepartures) {
    if (!dep.due_on) continue;
    // Guard against cross-boat matches if custom field was missing
    const depYacht = dep.name?.split(" | ")[1]?.trim().toLowerCase();
    if (depYacht && yachtVariants.length > 0 && !yachtVariants.includes(depYacht)) continue;
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
      [C.CUSTOM_FIELDS.YACHT_NAME]: yachtNameId,
      [C.CUSTOM_FIELDS.CHARTER_TYPE]: charterTypeId,
      [C.CUSTOM_FIELDS.START_DATE]: startDate,
      [C.CUSTOM_FIELDS.END_DATE]: endDate,
      [C.CUSTOM_FIELDS.CHARTER_NUMBER]: data.charter_number,
      [C.CUSTOM_FIELDS.TURNAROUND_DAYS]: closestDays < 10000 ? closestDays : null,
      [C.CUSTOM_FIELDS.START_DAY]: data.start_day || null,
      [C.CUSTOM_FIELDS.END_DAY]: data.end_day || null,
      [C.CUSTOM_FIELDS.BOARDING_TIME]: boardingTimeGid,
    },
  });

  // Sort DEPARTURE into correct day-of-week section
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const startDayName = days[new Date(startDate).getUTCDay()];
  if (startDayName && C.DAY_SECTIONS[startDayName]) {
    await asana.addTaskToSection(C.DAY_SECTIONS[startDayName], depTask.data.gid);
  }

  // Sort ARRIVAL into correct day-of-week section
  const endDayName = days[new Date(endDate).getUTCDay()];
  if (endDayName && C.DAY_SECTIONS[endDayName]) {
    await asana.addTaskToSection(C.DAY_SECTIONS[endDayName], arrTask.data.gid);
  }

  return { depTaskGid: depTask.data.gid, arrTaskGid: arrTask.data.gid };
}

/**
 * Step 15: Search for adjacent charters on the same yacht.
 * If gap ≤ 3 days, create debrief + Previous/Next Charter Scheduled tasks.
 * Tasks go into specific checkout project sections (matching real project).
 */
async function detectBackToBack(data, checkoutProjectGid, charterName, sectionMap, yachtNameId) {
  const t0 = Date.now();
  const yachtName = data.yacht_name?.trim();
  const startDate = data.start_date || data.start_on;
  const endDate = data.end_date || data.due_on;

  // Use name-based section lookup (passed from orchestrator)
  const vesselPrepSection = sectionMap["Vessel Prep Information"] || null;
  const untitledSection = sectionMap["Untitled section"] || null;

  // Search all projects in the Charter Info board for the same yacht
  const tSearch = Date.now();
  const effectiveYachtId = yachtNameId || data.yacht_name_id || null;
  const resolvedYacht = C.resolveYachtName(yachtName);
  const yachtVariants = C.getYachtNameVariants(yachtName).map(v => v.toLowerCase());
  const allProjects = await asana.searchTasks({
    "projects.any": C.BOARDS.CHARTER_INFO,
    ...(effectiveYachtId
      ? { [`custom_fields.${C.CUSTOM_FIELDS.YACHT_NAME}.value`]: effectiveYachtId }
      : { text: `"${resolvedYacht}"` }),
    "opt_fields": "name,start_on,due_on",
  });
  logger.info(`[B2B] Search completed in ${Date.now() - tSearch}ms — found ${allProjects.length} charters`);

  let closestPrev = null;
  let closestPrevDays = 10000;
  let closestNext = null;
  let closestNextDays = 10000;

  for (const proj of allProjects) {
    if (!proj.due_on || !proj.start_on) continue;
    // Skip self
    if (proj.name === charterName) continue;
    // Guard against cross-boat matches if custom field was missing
    const projYacht = proj.name?.split(" | ")[0]?.trim().toLowerCase();
    if (projYacht && yachtVariants.length > 0 && !yachtVariants.includes(projYacht)) continue;

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

  // Build all task creates concurrently
  const taskPromises = [];

  // Previous Charter Scheduled task
  if (closestPrev && closestPrevDays <= 7 && vesselPrepSection) {
    taskPromises.push((async () => {
      const prevTask = await asana.createTask({
        name: `Previous Charter Scheduled - ${closestPrev.name}`,
        projects: [checkoutProjectGid],
        due_on: closestPrev.due_on,
      });
      await asana.addTaskToSection(vesselPrepSection, prevTask.data.gid);
      logger.info(`[B2B] Previous charter: ${closestPrev.name} (${closestPrevDays} days gap)`);
    })());
  }

  // Next Charter Scheduled task
  if (closestNext && closestNextDays <= 7 && vesselPrepSection) {
    taskPromises.push((async () => {
      const nextTask = await asana.createTask({
        name: `Next Charter Scheduled - ${closestNext.name}`,
        projects: [checkoutProjectGid],
        due_on: closestNext.start_on,
      });
      await asana.addTaskToSection(vesselPrepSection, nextTask.data.gid);
      logger.info(`[B2B] Next charter: ${closestNext.name} (${closestNextDays} days gap)`);
    })());
  }

  // Debrief tasks in Section 0 if back-to-back (≤3 days)
  if (closestPrevDays <= 3 && closestPrev && untitledSection) {
    const prevParts = closestPrev.name.split(" | ");
    const prevClient = prevParts.length > 1 ? prevParts[1] : closestPrev.name;

    taskPromises.push((async () => {
      const passOnTask = await asana.createTask({
        name: `Pass on ${yachtName}   ${prevClient} Debrief`,
        projects: [checkoutProjectGid],
      });
      await asana.addTaskToSection(untitledSection, passOnTask.data.gid);
    })());

    taskPromises.push((async () => {
      const getDebriefTask = await asana.createTask({
        name: `Get Debrief ${charterName}`,
        projects: [checkoutProjectGid],
      });
      await asana.addTaskToSection(untitledSection, getDebriefTask.data.gid);
    })());

    logger.info(`[B2B] Back-to-back debrief tasks queued (${closestPrevDays} day gap)`);
  }

  if (taskPromises.length > 0) {
    await Promise.all(taskPromises);
  }

  logger.info(`[B2B] detectBackToBack completed in ${Date.now() - t0}ms (${taskPromises.length} tasks created)`);
}

// NOTE: Maintenance tasks are now handled by maintenanceService.js (separate endpoint)

// NOTE: Housekeeping tasks are now handled by housekeepingService.js (separate endpoint)

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
