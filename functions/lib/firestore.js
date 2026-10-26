// ============================================================
// Firestore helpers — read config + manage provisioning state
// ============================================================
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getYachtNameVariants } = require("../config/constants");

function getDb() {
  return getFirestore("powerautomate");
}

function getDefaultDb() {
  return getFirestore();
}

// --- Read config collections ---

async function getYachtConfig(yachtName) {
  const db = getDb();
  const snap = await db.collection("yacht_config")
    .where("name", "==", yachtName.trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getCharterTemplate(charterType) {
  const db = getDb();
  const snap = await db.collection("charter_templates")
    .where("charterType", "==", charterType.trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

async function getCrewMember(collection, name) {
  // collection = "captains" | "chefs" | "brokers"
  const db = getDb();
  const snap = await db.collection("crew_config").doc(collection)
    .collection("members")
    .where("name", "==", name.trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

async function getStandardJobs(yachtName) {
  const db = getDb();
  const docId = yachtName.trim().toLowerCase().replace(/\s+/g, "-");
  const doc = await db.collection("standard_jobs").doc(docId).get();
  if (!doc.exists) return null;
  return doc.data();
}

async function getHousekeepingList(listName) {
  // listName = "interior-a", "exterior-b", etc.
  const db = getDb();
  const doc = await db.collection("housekeeping_lists").doc(listName).get();
  if (!doc.exists) return null;
  return doc.data();
}

// --- Provisioning state (replaces "bridging task" hack) ---

async function saveProvisioningState(charterNumber, data) {
  const db = getDb();
  await db.collection("provisioning_state").doc(`charter-${charterNumber}`).set({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getProvisioningState(charterNumber) {
  const db = getDb();
  const doc = await db.collection("provisioning_state").doc(`charter-${charterNumber}`).get();
  if (doc.exists) return doc.data();

  // Fallback check in (default) database in case any state was written during a misconfigured deploy
  try {
    const fallbackDoc = await getDefaultDb().collection("provisioning_state").doc(`charter-${charterNumber}`).get();
    if (fallbackDoc.exists) return fallbackDoc.data();
  } catch {
    // Ignore fallback errors
  }
  return null;
}

async function deleteProvisioningState(charterNumber) {
  const db = getDb();
  await db.collection("provisioning_state").doc(`charter-${charterNumber}`).delete();
  await getDefaultDb().collection("provisioning_state").doc(`charter-${charterNumber}`).delete().catch(() => {});
}

/**
 * Find the most recent charter for a yacht whose endDate is before the given startDate.
 * Checks all known name variants (e.g. "Miles Away" and "Miles Away II") and returns
 * the closest match so back-to-back bridging works across alias changes.
 */
async function getPreviousCharter(yachtName, currentStartDate) {
  const db = getDb();
  const variants = getYachtNameVariants(yachtName);
  const namesToQuery = variants.length > 0 ? variants : [yachtName];

  const snaps = await Promise.all(
    namesToQuery.map(name =>
      db.collection("provisioning_state")
        .where("yachtName", "==", name)
        .where("endDate", "<", currentStartDate)
        .orderBy("endDate", "desc")
        .limit(1)
        .get()
        .catch(() => ({ empty: true, docs: [] }))
    )
  );

  const candidates = snaps
    .filter(s => !s.empty && s.docs.length > 0)
    .map(s => s.docs[0].data());

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));
  return candidates[0];
}

/**
 * Find the earliest charter for a yacht whose startDate is after the given endDate.
 * Checks all known name variants (e.g. "Miles Away" and "Miles Away II") and returns
 * the closest match so back-to-back bridging works across alias changes.
 */
async function getNextCharter(yachtName, currentEndDate) {
  const db = getDb();
  const variants = getYachtNameVariants(yachtName);
  const namesToQuery = variants.length > 0 ? variants : [yachtName];

  const snaps = await Promise.all(
    namesToQuery.map(name =>
      db.collection("provisioning_state")
        .where("yachtName", "==", name)
        .where("startDate", ">", currentEndDate)
        .orderBy("startDate", "asc")
        .limit(1)
        .get()
        .catch(() => ({ empty: true, docs: [] }))
    )
  );

  const candidates = snaps
    .filter(s => !s.empty && s.docs.length > 0)
    .map(s => s.docs[0].data());

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  return candidates[0];
}

// --- Audit log (powers the operations dashboard) ---

/**
 * Create a new audit event at the start of an operation.
 * Returns the auto-generated eventId for subsequent updates.
 */
async function createAuditEvent(charterNumber, eventData) {
  const db = getDb();
  const ref = await db
    .collection("charter_audit_log")
    .doc(`charter-${charterNumber}`)
    .collection("events")
    .add({
      ...eventData,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      success: null,
    });
  return ref.id;
}

/**
 * Update an existing audit event with stage results / completion status.
 */
/** Update stage data mid-run — does NOT set completedAt, keeps event "in-progress" */
async function updateAuditStage(charterNumber, eventId, updates) {
  const db = getDb();
  await db
    .collection("charter_audit_log")
    .doc(`charter-${charterNumber}`)
    .collection("events")
    .doc(eventId)
    .update(updates);
}

/** Final completion write — sets completedAt to mark the whole event as done */
async function updateAuditEvent(charterNumber, eventId, updates) {
  const db = getDb();
  await db
    .collection("charter_audit_log")
    .doc(`charter-${charterNumber}`)
    .collection("events")
    .doc(eventId)
    .update({
      ...updates,
      completedAt: FieldValue.serverTimestamp(),
    });
}

// --- Operation Lock + Queue (per-charter serialization) ---

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 min — auto-expire stale locks
const MAX_QUEUE_DEPTH = 3;

/**
 * Try to acquire an operation lock for a charter.
 * Uses a Firestore transaction for atomicity.
 * Returns { acquired: true } if lock was free or expired.
 * Returns { acquired: false, currentAction } if another op is running.
 */
async function acquireOperationLock(charterNumber, action, auditId) {
  const db = getDb();
  const lockRef = db.collection("operation_locks").doc(`charter-${charterNumber}`);

  return db.runTransaction(async (txn) => {
    const lockDoc = await txn.get(lockRef);

    if (lockDoc.exists) {
      const data = lockDoc.data();
      const lockedAt = data.lockedAt?.toMillis?.() || 0;
      const isExpired = Date.now() - lockedAt > LOCK_TTL_MS;

      if (!isExpired) {
        // Lock is held and valid
        return { acquired: false, currentAction: data.action };
      }
      // Lock expired — steal it (previous op likely crashed)
    }

    // Acquire the lock
    txn.set(lockRef, {
      action,
      auditId,
      lockedAt: FieldValue.serverTimestamp(),
    });
    return { acquired: true };
  });
}

/**
 * Release the operation lock for a charter.
 */
async function releaseOperationLock(charterNumber) {
  const db = getDb();
  await db.collection("operation_locks").doc(`charter-${charterNumber}`).delete();
}

/**
 * Append an operation to the FIFO queue.
 * Returns the position in queue (1-indexed).
 * Queue is capped at MAX_QUEUE_DEPTH — position 3 overwrites the last item.
 */
async function enqueueOperation(charterNumber, action, payload) {
  const db = getDb();
  const queueRef = db.collection("pending_operations").doc(`charter-${charterNumber}`);

  return db.runTransaction(async (txn) => {
    const doc = await txn.get(queueRef);
    let queue = doc.exists ? (doc.data().queue || []) : [];

    const entry = { action, payload, queuedAt: Date.now() };

    if (queue.length >= MAX_QUEUE_DEPTH) {
      // Cap: overwrite the last slot
      queue[MAX_QUEUE_DEPTH - 1] = entry;
    } else {
      queue.push(entry);
    }

    txn.set(queueRef, { queue });
    return queue.length;
  });
}

/**
 * Pop the next operation from the FIFO queue.
 * Returns { action, payload, queuedAt } or null if empty.
 */
async function dequeueOperation(charterNumber) {
  const db = getDb();
  const queueRef = db.collection("pending_operations").doc(`charter-${charterNumber}`);

  return db.runTransaction(async (txn) => {
    const doc = await txn.get(queueRef);
    if (!doc.exists) return null;

    const queue = doc.data().queue || [];
    if (queue.length === 0) {
      txn.delete(queueRef);
      return null;
    }

    const next = queue.shift(); // FIFO — take the first

    if (queue.length === 0) {
      txn.delete(queueRef);
    } else {
      txn.set(queueRef, { queue });
    }

    return next;
  });
}

/**
 * Cancel the latest in-progress operation for a charter.
 * Marks the audit event as cancelled and returns the event ID.
 */
async function cancelOperation(charterNumber) {
  const db = getDb();
  const parentRef = db.collection("charter_audit_log").doc(`charter-${charterNumber}`);
  const eventsSnap = await parentRef.collection("events")
    .where("completedAt", "==", null)
    .orderBy("startedAt", "desc")
    .limit(1)
    .get();

  if (eventsSnap.empty) return null;

  const doc = eventsSnap.docs[0];
  await doc.ref.update({
    success: false,
    cancelled: true,
    completedAt: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

/**
 * Clear all pending operations for a charter.
 */
async function clearPendingQueue(charterNumber) {
  const db = getDb();
  await db.collection("pending_operations").doc(`charter-${charterNumber}`).delete().catch(() => {});
}

module.exports = {
  getDb,
  getYachtConfig,
  getCharterTemplate,
  getCrewMember,
  getStandardJobs,
  getHousekeepingList,
  saveProvisioningState,
  getProvisioningState,
  deleteProvisioningState,
  getPreviousCharter,
  getNextCharter,
  createAuditEvent,
  updateAuditStage,
  updateAuditEvent,
  acquireOperationLock,
  releaseOperationLock,
  enqueueOperation,
  dequeueOperation,
  cancelOperation,
  clearPendingQueue,
};
