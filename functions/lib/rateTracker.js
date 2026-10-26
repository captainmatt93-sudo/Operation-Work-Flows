// ============================================================
// Rate Tracker — Asana API usage monitor + adaptive concurrency
// ============================================================
// Tracks outgoing Asana request timestamps in a sliding 60s window
// (in-memory, per Cloud Function instance). On each minute boundary,
// flushes a snapshot to Firestore so the dashboard can graph trends.
// 429 events are written to Firestore immediately for the event feed.
// ============================================================

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

function getDb() {
  return getFirestore("powerautomate");
}

// ── In-memory state ───────────────────────────────────────────
/** @type {number[]} Timestamps (ms) of each outgoing request in the last 60s */
const requestTimestamps = [];

/** Current count of in-flight mutating requests (POST/PUT/PATCH/DELETE) */
let inFlightWrites = 0;

/** True while we are in a 429-triggered backoff period */
let inBackoff = false;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── Snapshot flush (every 60s) ─────────────────────────────────
// setInterval fires once the module loads — safe in Cloud Functions
// because the function stays warm between requests within an instance.
let snapshotInterval = null;

function startSnapshotFlush() {
  if (snapshotInterval) return; // already running
  snapshotInterval = setInterval(flushSnapshot, 60_000);
}

// Kick off immediately on first import
startSnapshotFlush();

// ── Core helpers ──────────────────────────────────────────────

/**
 * Prune timestamps older than 60 seconds from the ring buffer.
 * Called before any RPM read to keep the window accurate.
 */
function pruneOldTimestamps() {
  const cutoff = Date.now() - 60_000;
  let i = 0;
  while (i < requestTimestamps.length && requestTimestamps[i] < cutoff) i++;
  if (i > 0) requestTimestamps.splice(0, i);
}

/** Return current requests-per-minute from the sliding window. */
function getRpm() {
  pruneOldTimestamps();
  return requestTimestamps.length;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Call BEFORE every Asana API request.
 * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 */
function recordRequest(method) {
  requestTimestamps.push(Date.now());
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    inFlightWrites++;
  }
}

/**
 * Call AFTER every Asana API request (success or non-429 error).
 * @param {string} method - HTTP method
 */
function recordComplete(method) {
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    inFlightWrites = Math.max(0, inFlightWrites - 1);
  }
}

/**
 * Call when Asana returns 429.
 * Writes an event doc to Firestore and sets the backoff flag for
 * getConcurrencyLevel() to return 'serialised'.
 *
 * @param {string} endpoint  - e.g. "/tasks"
 * @param {number} retryAfter - seconds from Retry-After header
 * @param {string} [charterNumber] - optional context
 */
async function record429(endpoint, retryAfter, charterNumber = null) {
  inBackoff = true;

  // Clear the backoff flag once the retry-after window has elapsed
  setTimeout(() => { inBackoff = false; }, (retryAfter + 5) * 1000);

  try {
    const db = getDb();
    await db.collection("rate_monitor").doc("events").collection("items").add({
      ts: FieldValue.serverTimestamp(),
      endpoint,
      retryAfter,
      charterNumber,
    });
  } catch (err) {
    // Non-fatal — don't let a Firestore write failure cascade
    console.warn(`[RATE] Failed to write 429 event to Firestore: ${err.message}`);
  }
}

/**
 * Returns the current adaptive concurrency level based on RPM.
 *
 * @returns {{ level: "full"|"reduced"|"minimal"|"serialised", rpm: number, inFlight: number }}
 */
function getConcurrencyLevel() {
  const rpm = getRpm();

  let level;
  if (inBackoff || rpm > 1350) {
    level = "serialised";
  } else if (rpm > 1200) {
    level = "minimal";
  } else if (rpm > 750) {
    level = "reduced";
  } else {
    level = "full";
  }

  return { level, rpm, inFlight: inFlightWrites };
}

/**
 * Writes the current minute's stats to Firestore.
 * Called automatically every 60s. Also callable manually for testing.
 */
async function flushSnapshot() {
  const rpm = getRpm();
  if (rpm === 0 && inFlightWrites === 0) return; // nothing to record

  const now = new Date();
  const key = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
  ].join("-");

  try {
    const db = getDb();
    await db.collection("rate_monitor").doc("snapshots").collection("items").doc(key).set({
      rpm,
      inFlight: inFlightWrites,
      ts: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn(`[RATE] Failed to flush snapshot: ${err.message}`);
  }
}

module.exports = {
  recordRequest,
  recordComplete,
  record429,
  getRpm,
  getConcurrencyLevel,
  flushSnapshot,
};
