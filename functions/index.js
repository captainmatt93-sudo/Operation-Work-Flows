// ============================================================
// Cloud Function Entry Point — Charter Orchestration Engine
// ============================================================
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { orchestrateNewCharter } = require("./services/charterOrchestrator");
const { deleteCharter } = require("./services/charterCleaner");
const { executeMaintenanceFlow } = require("./services/maintenanceService");
const { executeHousekeepingFlow } = require("./services/housekeepingService");
const db = require("./lib/firestore");
const { createAuditEvent, updateAuditStage, updateAuditEvent,
        acquireOperationLock, releaseOperationLock, enqueueOperation, dequeueOperation,
        cancelOperation, clearPendingQueue } = db;

/**
 * Fire Maint + HK concurrently in the background (no await).
 * Cloud Run container stays alive while these Promises are pending.
 * Maint+HK take ~109s — well within the Cloud Run warm window.
 */
function fireMaintAndHK(charterNumber, maintPayload, hkPayload) {
  Promise.all([
    executeMaintenanceFlow(maintPayload)
      .catch(err => logger.error(`[BG] Maint failed for ${charterNumber}: ${err.message}`)),
    executeHousekeepingFlow(hkPayload)
      .catch(err => logger.error(`[BG] HK failed for ${charterNumber}: ${err.message}`)),
  ]).catch(() => {});
}

/**
 * Check the queue for the next pending operation and execute it.
 * Fires in the background (no await) — the current response has already been sent.
 */
function processQueuedOperation(charterNumber) {
  ;(async () => {
    try {
      const next = await dequeueOperation(charterNumber);
      if (!next) {
        logger.info(`[QUEUE] No pending operations for ${charterNumber}`);
        return;
      }

      logger.info(`[QUEUE] Dequeued ${next.action} for ${charterNumber} (waited ${Date.now() - next.queuedAt}ms)`);

      // Re-enter the pipeline via internal fetch to the same endpoint
      // This reuses all validation, normalization, lock acquisition, and audit logic
      const selfUrl = process.env.FUNCTION_TARGET_URL || `https://charterevents-m42u5ow2pq-uk.a.run.app`;
      const apiKey = process.env.WEBHOOK_API_KEY;

      const resp = await fetch(selfUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ data: { ...next.payload, section: next.action, _queuedAt: next.queuedAt } }),
      });

      const body = await resp.json().catch(() => ({}));
      logger.info(`[QUEUE] Dequeued ${next.action} for ${charterNumber} completed: ${resp.status} ${body.Status || body.error || ""}`);
    } catch (err) {
      logger.error(`[QUEUE] Failed to process queued operation for ${charterNumber}: ${err.message}`);
      // Release lock so it doesn't stay stuck
      await releaseOperationLock(charterNumber).catch(() => {});
    }
  })();
}

/**
 * Validate required fields. Returns an error string or null.
 */
function validateRequired(data, includeCreateFields = false) {
  if (!data.charter_number) return "Missing required field: charter_number";
  if (includeCreateFields) {
    if (!data.start_date)  return "Missing required field: start_date";
    if (!data.end_date)    return "Missing required field: end_date";
    if (!data.yacht_name)  return "Missing required field: yacht_name";
  }
  return null;
}

// Initialize Firebase Admin
admin.initializeApp();

// ── GID-to-day-name reverse mapping for IN/OUT section placement ──
const DAY_GID_TO_NAME = {
  "1201397001796765": "Sunday",
  "1201397001796940": "Monday",
  "1201397001797135": "Tuesday",
  "1201397001797333": "Wednesday",
  "1201397001797532": "Thursday",
  "1201397001797731": "Thursday",
  "1201397001797961": "Saturday",
  "1201397057042239": "Sunday",
  "1201397057042448": "Monday",
  "1201397057042657": "Wednesday",
  "1201397057043918": "Tuesday",
  "1201397057044095": "Thursday",
  "1201397057044286": "Friday",
  "1201397057046785": "Sunday",
  "1201397057046376": "Saturday",
};

/**
 * Normalize the charter flow payload into a consistent internal format.
 *
 * The real payload from Flow 1 → Flow 2 looks like:
 * {
 *   data: {
 *     charter_name: "Yacht | Client | Start | End",
 *     start_date, end_date,
 *     start_day: "<GID>",        ← enum GID, NOT "Sunday"
 *     end_day: "<GID>",          ← enum GID, NOT "Sunday"
 *     yacht_name, yacht_name_id,
 *     charter_type, charter_type_id,
 *     client_name: "Downing",    ← short name
 *     contact_name: "Full Name", ← full name
 *     boarding_time: { display: "12:00 PM", gid: "<GID>" },
 *     captain: '""',             ← escaped empty string when no captain
 *     chef: '""',
 *     ...
 *   }
 * }
 */
function normalizePayload(rawData) {
  const d = { ...rawData };

  // Fix captain/chef — Power Automate sends '""' for empty
  if (d.captain === '""' || d.captain === '""' || !d.captain) d.captain = null;
  if (d.chef === '""' || d.chef === '""' || !d.chef) d.chef = null;

  // Resolve Enums + Yacht Name Aliases
  const C = require("./config/constants");
  const resolvedYacht = d.yacht_name ? C.resolveYachtName(d.yacht_name) : null;

  // Auto-resolve model from boat name if yacht_model not explicitly provided
  const resolvedModel = d.yacht_model || C.BOAT_TO_MODEL[d.yacht_name] || (resolvedYacht ? C.BOAT_TO_MODEL[resolvedYacht] : null) || null;
  d.yacht_model = resolvedModel;
  d.yacht_model_id = resolvedModel ? (C.YACHT_MODELS[resolvedModel] || null) : null;
  d.sales_agent_id = d.sales_agent ? (C.SALES_AGENTS[d.sales_agent] || null) : null;
  // Auto-resolve yacht_name_id from the YACHT_NAME_GIDS map if not provided
  d.yacht_name_id = d.yacht_name_id
    || (d.yacht_name ? (C.YACHT_NAME_GIDS[d.yacht_name] || (resolvedYacht ? C.YACHT_NAME_GIDS[resolvedYacht] : null)) : null)
    || null;
  d.charter_type_id = d.charter_type_id || null;

  // Auto-resolve start_day / end_day GIDs from date when not provided by caller
  const startDayName = getDayName(d.start_date);
  const endDayName = getDayName(d.end_date);
  d.start_day = d.start_day || C.START_DAY_GIDS[startDayName] || null;
  d.end_day = d.end_day || C.END_DAY_GIDS[endDayName] || null;
  d.start_day_id = d.start_day;
  d.end_day_id = d.end_day;
  d.start_day_name = startDayName;
  d.end_day_name = endDayName;

  // boarding_time — can be object { display, gid } or string
  if (d.boarding_time && typeof d.boarding_time === "object") {
    d.boarding_time_display = d.boarding_time.display || "";
    d.boarding_time_gid = d.boarding_time.gid || null;
  } else {
    d.boarding_time_display = d.boarding_time || "";
    d.boarding_time_gid = null;
  }

  // number_of_guests → number_guests (our code uses number_guests)
  d.number_guests = d.number_guests || d.number_of_guests || null;

  // contact_name → full name (required), client_name → derived last name
  d.contact_name = d.contact_name || d.client_name || "";
  if (!d.client_name && d.contact_name) {
    const parts = d.contact_name.trim().split(/\s+/);
    d.client_name = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  }
  d.client_name = d.client_name || d.contact_name || "";

  // Derive section/action from charter_name if not provided
  if (!d.section) d.section = "Create";

  // Charter name — use provided or build from fields (only when fields exist)
  if (!d.charter_name && d.yacht_name && d.start_date && d.end_date) {
    d.charter_name = `${d.yacht_name} | ${d.client_name} | ${d.start_date} | ${d.end_date}`;
  }

  return d;
}

function getDayName(dateStr) {
  if (!dateStr) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date(dateStr).getUTCDay()];
}

/**
 * Main webhook endpoint.
 * POST /charterEvents
 *
 * Headers: x-api-key: <configured secret>
 * Body: { data: { ... } } — charter flow payload
 */
exports.charterEvents = onRequest(
  { region: "us-east4", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    // --- Method check ---
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // --- API Key authentication ---
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WEBHOOK_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      logger.warn("Unauthorized request — invalid or missing API key");
      return res.status(401).json({ error: "Unauthorized" });
    }

    // --- Parse + normalize payload ---
    const payload = req.body;
    if (!payload || !payload.data) {
      return res.status(400).json({ error: "Missing payload data" });
    }

    const data = normalizePayload(payload.data);
    const action = data.section?.trim();
    const charterNumber = data.charter_number;
    logger.info(`Received ${action} request for charter ${charterNumber}`);
    logger.info(`Normalized payload: yacht=${data.yacht_name}, client=${data.client_name}, dates=${data.start_date}→${data.end_date}`);

    // ── Per-charter operation lock ──────────────────────────────
    const lockResult = await acquireOperationLock(charterNumber, action, null).catch(() => ({ acquired: true }));
    if (!lockResult.acquired) {
      logger.info(`[QUEUE] ${action} for ${charterNumber} queued — ${lockResult.currentAction} in progress`);
      const position = await enqueueOperation(charterNumber, action, data);
      return res.status(202).json({
        Status: "202 Queued",
        position,
        message: `Charter ${charterNumber} has a ${lockResult.currentAction} in progress. Your ${action} request is queued at position ${position} and will execute automatically.`,
      });
    }
    logger.info(`[LOCK] Acquired lock for ${charterNumber} (${action})`);

    // Queue metadata — present if this request was dequeued from the pending queue
    const queueMeta = data._queuedAt ? {
      queuedAt: data._queuedAt,
      dequeuedAt: Date.now(),
      queueWaitMs: Date.now() - data._queuedAt,
    } : {};
    if (data._queuedAt) logger.info(`[QUEUE] Processing dequeued ${action} for ${charterNumber} (waited ${queueMeta.queueWaitMs}ms)`);

    try {
      switch (action) {
        case "Create": {
          const valErr = validateRequired(data, true);
          if (valErr) {
            await releaseOperationLock(charterNumber).catch(() => {});
            return res.status(400).json({ error: valErr });
          }

          const auditId = await createAuditEvent(charterNumber, {
            action: "Create",
            charterNumber,
            yachtName: data.yacht_name,
            clientName: data.client_name,
            startDate: data.start_date,
            endDate: data.end_date,
            charterType: data.charter_type,
            ...queueMeta,
          }).catch(() => null);

          const t0 = Date.now();
          const result = await orchestrateNewCharter({ data });
          if (!result.success) {
            if (auditId) await updateAuditEvent(charterNumber, auditId, { success: false, error: result.error, stages: { orchestrate: { success: false } } }).catch(() => {});
            await releaseOperationLock(charterNumber).catch(() => {});
            processQueuedOperation(charterNumber);
            return res.status(400).json({ error: result.error || "Charter creation failed" });
          }

          const orchMs = Date.now() - t0;

          // Write orchestrate stage immediately (no completedAt — event stays "in-progress")
          if (auditId) await updateAuditStage(charterNumber, auditId, {
            "stages.orchestrate": { success: true, durationMs: orchMs, charterProjectGid: result.charterProjectGid, checkoutProjectGid: result.checkoutProjectGid },
          }).catch(() => {});

          // Fire Maint then HK sequentially in the background
          // updateAuditStage = no completedAt, updateAuditEvent = final stamp
          ;(() => {
            (async () => {
              // ── Maint first ──
              const tMaint = Date.now();
              if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { startedAtMs: tMaint } }).catch(() => {});
              try {
                const r = await executeMaintenanceFlow(result.maintPayload);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { success: r.success, startedAtMs: tMaint, durationMs: Date.now() - tMaint, tasksCreated: r.tasksCreated, subtasksCreated: r.subtasksCreated, ...(r.error ? { error: r.error } : {}) } }).catch(() => {});
              } catch (err) {
                logger.error(`[BG] Maint failed for ${charterNumber}: ${err.message}`);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { success: false, startedAtMs: tMaint, error: err.message } }).catch(() => {});
              }

              // ── HK second ──
              const tHk = Date.now();
              if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { startedAtMs: tHk } }).catch(() => {});
              try {
                const r = await executeHousekeepingFlow(result.hkPayload);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { success: r.success, startedAtMs: tHk, durationMs: Date.now() - tHk, tasksCreated: r.tasksCreated, subtasksCreated: r.subtasksCreated, ...(r.error ? { error: r.error } : {}) } }).catch(() => {});
              } catch (err) {
                logger.error(`[BG] HK failed for ${charterNumber}: ${err.message}`);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { success: false, startedAtMs: tHk, error: err.message } }).catch(() => {});
              }

              // ── Final completion — stamps completedAt ──
              if (auditId) await updateAuditEvent(charterNumber, auditId, { success: true }).catch(() => {});

              // ── Release lock + pick up queued operation ──
              await releaseOperationLock(charterNumber).catch(() => {});
              processQueuedOperation(charterNumber);
            })();
          })();

          return res.status(200).json({
            Status: "200 Success",
            charterProjectGid: result.charterProjectGid,
            checkoutProjectGid: result.checkoutProjectGid,
          });
        }

        case "Delete": {
          const valErr = validateRequired(data);
          if (valErr) {
            await releaseOperationLock(charterNumber).catch(() => {});
            return res.status(400).json({ error: valErr });
          }

          const auditId = await createAuditEvent(charterNumber, {
            action: "Delete",
            charterNumber,
            yachtName: data.yacht_name,
            clientName: data.client_name,
            startDate: data.start_date,
            endDate: data.end_date,
            ...queueMeta,
          }).catch(() => null);

          const t0 = Date.now();
          const result = await deleteCharter({ data });
          if (auditId) await updateAuditEvent(charterNumber, auditId, {
            success: result.success,
            "stages.delete": {
              success: result.success,
              durationMs: Date.now() - t0,
              ...(result.error ? { error: result.error } : {}),
            },
          }).catch(() => {});

          // ── Release lock + pick up queued operation ──
          await releaseOperationLock(charterNumber).catch(() => {});
          processQueuedOperation(charterNumber);

          return res.status(200).json({ Status: "200 Success", ...result });
        }

        case "Edit": {
          const valErr = validateRequired(data, true);
          if (valErr) {
            await releaseOperationLock(charterNumber).catch(() => {});
            return res.status(400).json({ error: valErr });
          }

          const auditId = await createAuditEvent(charterNumber, {
            action: "Edit",
            charterNumber,
            yachtName: data.yacht_name,
            clientName: data.client_name,
            startDate: data.start_date,
            endDate: data.end_date,
            charterType: data.charter_type,
            ...queueMeta,
          }).catch(() => null);

          const t0 = Date.now();
          const tDel = Date.now();

          // Check if charter exists before trying to delete
          const existingState = await db.getProvisioningState(charterNumber);
          if (existingState) {
            if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.delete": { startedAtMs: tDel } }).catch(() => {});
            const delResult = await deleteCharter({ data: { ...data, section: "Delete" } });
            const delMs = Date.now() - tDel;
            if (auditId) await updateAuditStage(charterNumber, auditId, {
              "stages.delete": { success: delResult.success, startedAtMs: tDel, durationMs: delMs },
            }).catch(() => {});
          } else {
            logger.info(`Edit for ${charterNumber}: charter not found — treating as Create`);
            if (auditId) await updateAuditStage(charterNumber, auditId, {
              "stages.delete": { success: true, startedAtMs: tDel, durationMs: 0, skipped: true, reason: "Charter not found — created instead" },
            }).catch(() => {});
          }

          const result = await orchestrateNewCharter({ data });
          if (!result.success) {
            if (auditId) await updateAuditEvent(charterNumber, auditId, { success: false, error: result.error }).catch(() => {});
            await releaseOperationLock(charterNumber).catch(() => {});
            processQueuedOperation(charterNumber);
            return res.status(400).json({ error: result.error || "Charter recreation failed after deletion" });
          }

          const orchMs = Date.now() - t0;

          // Write orchestrate stage immediately (no completedAt)
          if (auditId) await updateAuditStage(charterNumber, auditId, {
            "stages.orchestrate": { success: true, durationMs: orchMs, charterProjectGid: result.charterProjectGid, checkoutProjectGid: result.checkoutProjectGid },
          }).catch(() => {});

          // Maint then HK sequentially in background
          ;(() => {
            (async () => {
              const tMaint = Date.now();
              if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { startedAtMs: tMaint } }).catch(() => {});
              try {
                const r = await executeMaintenanceFlow(result.maintPayload);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { success: r.success, startedAtMs: tMaint, durationMs: Date.now() - tMaint, tasksCreated: r.tasksCreated, subtasksCreated: r.subtasksCreated, ...(r.error ? { error: r.error } : {}) } }).catch(() => {});
              } catch (err) {
                logger.error(`[BG] Maint failed for ${charterNumber}: ${err.message}`);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.maint": { success: false, startedAtMs: tMaint, error: err.message } }).catch(() => {});
              }

              const tHk = Date.now();
              if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { startedAtMs: tHk } }).catch(() => {});
              try {
                const r = await executeHousekeepingFlow(result.hkPayload);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { success: r.success, startedAtMs: tHk, durationMs: Date.now() - tHk, tasksCreated: r.tasksCreated, subtasksCreated: r.subtasksCreated, ...(r.error ? { error: r.error } : {}) } }).catch(() => {});
              } catch (err) {
                logger.error(`[BG] HK failed for ${charterNumber}: ${err.message}`);
                if (auditId) await updateAuditStage(charterNumber, auditId, { "stages.hk": { success: false, startedAtMs: tHk, error: err.message } }).catch(() => {});
              }

              if (auditId) await updateAuditEvent(charterNumber, auditId, { success: true }).catch(() => {});

              // ── Release lock + pick up queued operation ──
              await releaseOperationLock(charterNumber).catch(() => {});
              processQueuedOperation(charterNumber);
            })();
          })();

          return res.status(200).json({
            Status: "200 Success",
            charterProjectGid: result.charterProjectGid,
            checkoutProjectGid: result.checkoutProjectGid,
          });
        }

        case "Cancel": {
          if (!charterNumber) {
            await releaseOperationLock(charterNumber).catch(() => {});
            return res.status(400).json({ error: "Missing charter_number" });
          }

          logger.info(`[CANCEL] Cancelling operation for ${charterNumber}`);
          const cancelledId = await cancelOperation(charterNumber).catch(() => null);
          await releaseOperationLock(charterNumber).catch(() => {});
          await clearPendingQueue(charterNumber).catch(() => {});
          logger.info(`[CANCEL] Done for ${charterNumber}: eventId=${cancelledId}`);

          return res.status(200).json({
            Status: "200 Cancelled",
            cancelledEventId: cancelledId,
            message: cancelledId
              ? `Operation cancelled and lock released for ${charterNumber}`
              : `No in-progress operation found for ${charterNumber}, lock and queue cleared`,
          });
        }

        default:
          logger.error(`Unknown action: ${action}`);
          await releaseOperationLock(charterNumber).catch(() => {});
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      logger.error(`Orchestration failed [${action}]: ${err.message}`, { stack: err.stack });
      // Release lock on error so queued ops aren't stuck
      await releaseOperationLock(charterNumber).catch(() => {});
      processQueuedOperation(charterNumber);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * Maintenance flow endpoint.
 * POST /maintenanceEvents
 *
 * Headers: x-api-key: <configured secret>
 * Body: { charterNumber: "SC-00260" }
 *
 * Loads maintPayload from Firestore and creates maintenance tasks.
 */
exports.maintenanceEvents = onRequest(
  { region: "us-east4", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // API Key authentication
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WEBHOOK_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      logger.warn("Unauthorized maintenance request");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const charterNumber = req.body?.charterNumber || req.body?.charter_number || req.body?.data?.charter_number;
    if (!charterNumber) {
      return res.status(400).json({ error: "Missing charterNumber" });
    }

    logger.info(`Maintenance request for charter ${charterNumber}`);

    try {
      // Load provisioning state from Firestore
      const state = await db.getProvisioningState(charterNumber);
      if (!state || !state.maintPayload) {
        return res.status(404).json({ error: `No maintenance payload found for ${charterNumber}` });
      }

      const result = await executeMaintenanceFlow(state.maintPayload);
      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.status(200).json({
        Status: "200 Success",
        ...result,
      });
    } catch (err) {
      logger.error(`Maintenance failed: ${err.message}`, { stack: err.stack });
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * Housekeeping flow endpoint.
 * POST /housekeepingEvents
 *
 * Headers: x-api-key: <configured secret>
 * Body: { charterNumber: "SC-00271" }
 *
 * Loads hkPayload from Firestore and creates housekeeping tasks.
 */
exports.housekeepingEvents = onRequest(
  { region: "us-east4", timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // API Key authentication
    const apiKey = req.headers["x-api-key"];
    const expectedKey = process.env.WEBHOOK_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      logger.warn("Unauthorized housekeeping request");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const charterNumber = req.body?.charterNumber || req.body?.charter_number || req.body?.data?.charter_number;
    if (!charterNumber) {
      return res.status(400).json({ error: "Missing charterNumber" });
    }

    logger.info(`Housekeeping request for charter ${charterNumber}`);

    try {
      const state = await db.getProvisioningState(charterNumber);
      if (!state || !state.hkPayload) {
        return res.status(404).json({ error: `No housekeeping payload found for ${charterNumber}` });
      }

      const result = await executeHousekeepingFlow(state.hkPayload);
      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.status(200).json({
        Status: "200 Success",
        ...result,
      });
    } catch (err) {
      logger.error(`Housekeeping failed: ${err.message}`, { stack: err.stack });
      return res.status(500).json({ error: err.message });
    }
  }
);
