// ============================================================
// Cloud Function Entry Point — Charter Orchestration Engine
// ============================================================
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { orchestrateNewCharter } = require("./services/charterOrchestrator");
const { deleteCharter } = require("./services/charterCleaner");

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

  // start_day / end_day are already GIDs in the real payload.
  // Map: start_day → start_day_id (the GID for custom field)
  //       and also resolve the day name for section placement
  d.start_day_id = d.start_day || d.start_day_id || null;
  d.end_day_id = d.end_day || d.end_day_id || null;
  d.start_day_name = DAY_GID_TO_NAME[d.start_day_id] || getDayName(d.start_date);
  d.end_day_name = DAY_GID_TO_NAME[d.end_day_id] || getDayName(d.end_date);

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

  // contact_name → full name, client_name → short name
  d.contact_name = d.contact_name || d.client_name || "";
  d.client_name = d.client_name || d.contact_name || "";

  // Derive section/action from charter_name if not provided
  if (!d.section) d.section = "Create";

  // Charter name — use provided or build from fields
  d.charter_name = d.charter_name
    || `${d.yacht_name} | ${d.client_name} | ${d.start_date} | ${d.end_date}`;

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

    try {
      switch (action) {
        case "Create": {
          const result = await orchestrateNewCharter({ data });
          if (!result.success) {
            return res.status(400).json(result);
          }
          return res.status(200).json({
            Status: "200 Success",
            charterProjectGid: result.charterProjectGid,
            checkoutProjectGid: result.checkoutProjectGid,
          });
        }

        case "Delete": {
          const result = await deleteCharter({ data });
          return res.status(200).json({ Status: "200 Success", ...result });
        }

        case "Edit": {
          // Edit = Delete old + HubSpot callback triggers re-create
          const deleteResult = await deleteCharter({
            data: { ...data, section: "Edit" },
          });
          return res.status(200).json({ Status: "200 Success", ...deleteResult });
        }

        default:
          logger.error(`Unknown action: ${action}`);
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }
    } catch (err) {
      logger.error(`Orchestration failed: ${err.message}`, { stack: err.stack });
      return res.status(500).json({ error: err.message });
    }
  }
);
