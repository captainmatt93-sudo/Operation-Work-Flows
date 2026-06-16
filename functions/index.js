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

/**
 * Main webhook endpoint.
 * POST /charterEvents
 *
 * Expected headers:
 *   x-api-key: <your configured secret>
 *
 * Expected body:
 *   {
 *     data: {
 *       section: "Create" | "Delete" | "Edit",
 *       charter_name: "Destiny | Gernon | 2022-01-22 | 2022-01-26",
 *       charter_number: "77573",
 *       yacht_name: "Destiny",
 *       yacht_name_id: "1201397077447620",
 *       charter_type: "Bareboat Crewed",
 *       charter_type_id: "1200083909657805",
 *       client_name: "Gernon",
 *       start_date: "2022-01-22",
 *       end_date: "2022-01-26",
 *       start_day: "Saturday",
 *       start_day_id: "1201397001797961",
 *       end_day: "Wednesday",
 *       end_day_id: "1201397057042657",
 *       captain: "Blade Goodall",
 *       chef: "Danica Nel",
 *       broker_name: "Clare Goodall",
 *       number_guests: "6",
 *       contact_email: "client@example.com",
 *       charter_price: 15000,
 *       boarding_time: { display: "12:00 PM", gid: "1200113358975918" },
 *       ...
 *     }
 *   }
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

    // --- Parse payload ---
    const payload = req.body;
    if (!payload || !payload.data) {
      return res.status(400).json({ error: "Missing payload data" });
    }

    const action = payload.data.section?.trim();
    const charterNumber = payload.data.charter_number;
    logger.info(`Received ${action} request for charter ${charterNumber}`);

    try {
      switch (action) {
        case "Create": {
          const result = await orchestrateNewCharter(payload);
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
          const result = await deleteCharter(payload);
          return res.status(200).json({ Status: "200 Success", ...result });
        }

        case "Edit": {
          // Edit = Delete old + HubSpot callback triggers re-create
          const deleteResult = await deleteCharter({
            data: { ...payload.data, section: "Edit" },
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
