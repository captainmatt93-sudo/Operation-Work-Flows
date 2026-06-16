// ============================================================
// Firestore helpers — read config + manage provisioning state
// ============================================================
const admin = require("firebase-admin");

function getDb() {
  return admin.firestore();
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
  if (!doc.exists) return null;
  return doc.data();
}

async function deleteProvisioningState(charterNumber) {
  const db = getDb();
  await db.collection("provisioning_state").doc(`charter-${charterNumber}`).delete();
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
};
