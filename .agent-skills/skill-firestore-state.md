# Firestore State Skill

## What This Is
`functions/lib/firestore.js` stores per-charter provisioning state in Firestore (project `paynow-3f9dc`, default database). This replaces the legacy "bridging task notes" hack for finding which Asana projects belong to a charter.

## Critical Rules

1. **Never write `undefined`.** The Admin SDK throws `Cannot use "undefined" as a Firestore value`. Coerce optional values with `|| null` before calling `saveProvisioningState`.
2. **Doc ID is `charter-{charter_number}`.** A missing `charter_number` produces `charter-undefined` and every such charter collides on one document.
3. **`set()` overwrites.** Re-running Create for the same charter number replaces the previous state, orphaning the first set of Asana projects (they become reachable only via legacy delete).
4. **State is written at Create Step 11** - after the projects and bridging task exist, before maintenance/HK/IN-OUT. Delete reads it in Step 1 and removes it in Step 5.
5. **`admin.initializeApp()` is called once in `index.js`.** Do not call it again in lib modules.

## `provisioning_state/charter-{charter_number}` Schema
| Field | Type | Source |
|---|---|---|
| `charterNumber` | string | `data.charter_number` |
| `charterName` | string | normalized charter name |
| `charterProjectGid` | string | Step 5 duplicate |
| `checkoutProjectGid` | string | Step 9 duplicate |
| `bridgingTaskGid` | string | Step 10 |
| `yachtName` | string | alias-resolved yacht name |
| `trackingTaskGid` | string | Step 3 |
| `createdAt` | Timestamp | `FieldValue.serverTimestamp()` |

If you add an artifact that Delete must remove, store its GID here and read it in `charterCleaner.js`.

## Helper Reference
| Function | Status | Notes |
|---|---|---|
| `saveProvisioningState(charterNumber, data)` | Used (Create Step 11) | Adds `createdAt` |
| `getProvisioningState(charterNumber)` | Used (Delete Step 1) | Returns `null` if missing |
| `deleteProvisioningState(charterNumber)` | Used (Delete Step 5) | |
| `getYachtConfig`, `getCharterTemplate`, `getCrewMember`, `getStandardJobs`, `getHousekeepingList` | **Unused** | Read `yacht_config`, `charter_templates`, `crew_config/*/members`, `standard_jobs`, `housekeeping_lists`. Config actually lives in `config/*.js`. Do not assume these collections are populated. |
| `getDb()` | Used internally | |

## Indexes
No composite indexes are required by the current code (all reads are by document ID). There is no `firestore.indexes.json` and no `firestore` section in `firebase.json`. If you add queries that filter + order on different fields (e.g. previous/next charter by `yachtName` + date), you must:
1. Create `firestore.indexes.json`.
2. Add `"firestore": { "indexes": "firestore.indexes.json" }` to `firebase.json`.
3. Deploy indexes separately: `npx firebase deploy --only firestore:indexes`.
Without the index the query throws `FAILED_PRECONDITION`; if it is inside a `try/catch` the feature silently does nothing.

## Inspecting State
Firebase Console -> project `paynow-3f9dc` -> Firestore -> `provisioning_state`. After a test Delete, confirm the `charter-TEST-...` document is gone.
