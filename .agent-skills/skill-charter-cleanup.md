# Charter Cleanup (Delete / Edit Flow) Skill

## What This Is
`deleteCharter(payload)` in `functions/services/charterCleaner.js` replaces legacy Flow 8 (Asana Website Delete). It removes every Asana artifact for a charter and deletes its Firestore state. It runs for both `Delete` and `Edit` actions.

## Critical Rules

1. **Edit = Delete + external re-create.** `index.js` calls `deleteCharter()` with `section: "Edit"`. After cleanup, Step 6 POSTs to the HubSpot service, which then sends a fresh `Create` payload. This function never re-creates anything itself.
2. **Lookup key is `charter_number`.** Firestore doc `provisioning_state/charter-{charter_number}`. If the payload has no `charter_number`, the lookup hits `charter-undefined` and falls back to legacy delete.
3. **Checkout deletion is NOT section-scoped in this repo.** Step 2 deletes **every task in every section** of the checkout project. (The Express Portal skill describes a section-scoped version - that code is not in this repo.)
4. **Most steps swallow errors.** Steps 2, 3, 3b, 3c wrap calls in `try/catch` and log a warning, so a "200 Success" response does not guarantee everything was removed. Check Cloud Logging for `[Delete Step` warnings.
5. **Step 4 master-board deletes are NOT wrapped.** A failure deleting a Laundry / Yacht Schedule / IN/OUT task throws, skips Step 5, and leaves the Firestore doc behind (500 response).
6. **Board searches rely on the `CHARTER_NUMBER` custom field** and `completed: false`. Completed tasks and tasks without the field are left alone.

## Step Map (Firestore path)
| Step | Lines | Action |
|---|---|---|
| 1 | `23-34` | `db.getProvisioningState(charterNumber)`; if missing -> `legacyDelete(data)` |
| 2 | `36-48` | Delete all tasks in all checkout project sections |
| 3 | `50-61` | `deleteProject(charterProjectGid)`, `deleteProject(checkoutProjectGid)` |
| 3b | `63-81` | Delete `trackingTaskGid`, then search Charter Info board by charter number and delete matches |
| 3c | `83-99` | Search + delete Arrivals and Departures board tasks by charter number |
| 4 | `101-132` | Search + delete Laundry, Yacht Schedule, IN/OUT board tasks by charter number |
| 5 | `134-136` | `db.deleteProvisioningState(charterNumber)` |
| 6 | `138-150` | `Edit` only: POST `{ charter_number, success: true }` to hardcoded HubSpot Cloud Run URL |

## Legacy Fallback (`legacyDelete`, L160-217)
Used for charters created before Firestore state existed, or when Step 11 of Create never ran.
1. Searches `teams.any = CHECKOUT_TEAM` for text `"Check-Out | Check-In, {charter_name}"` with `CHARTER_NUMBER` contains `{charter_number}`. **Requires both `charter_name` and `charter_number` in the payload.**
2. Reads the bridging task's `notes` and splits on `,` to get project GIDs (format written by Create Step 10: `"checkoutGid, charterGid"`).
3. Deletes all tasks in each project, then the project.
4. Cleans Laundry / Yacht Schedule / IN/OUT boards. **Does not** clean Charter Info, Arrivals, Departures, or the tracking task, and does **not** send the HubSpot callback on Edit.

## Coverage Check: What Create Makes vs What Delete Removes
| Created by Create flow | Removed by Delete flow? |
|---|---|
| Tracking task (Charter Info board) | Yes (Step 3b) |
| Charter project + its tasks | Project deleted (Step 3) |
| Checkout project + all tasks | Yes (Steps 2-3) |
| Maintenance tasks also multi-homed into yacht maintenance project (`addTaskToProject`) | Deleted with checkout tasks (same task GIDs) |
| Yacht Schedule board task (Step 12, only if `charterSection`) | Yes (Step 4) |
| IN/OUT DEPARTURE / ARRIVAL tasks | Yes (Step 4) - matched by `CHARTER_NUMBER` |
| Laundry board | Searched, but Create never writes to it |

When you add a new artifact to the Create flow, add a matching row here and make sure Delete covers it.

## Modifying This Flow
- Keep the order: tasks -> projects -> boards -> Firestore -> callback. Deleting Firestore state first would make a retry impossible.
- Wrap any new board cleanup in `try/catch` per task (pattern at L80) so one bad task does not abort the run.
- Do not change the HubSpot callback body shape without coordinating with the HubSpot service owner.
