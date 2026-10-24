# Charter Orchestration (Create Flow) Skill

## What This Is
`orchestrateNewCharter(payload)` in `functions/services/charterOrchestrator.js` replaces legacy Power Automate Flows 1-7. It runs **15 sequential steps** that create every Asana artifact for a new charter. It is called from `index.js` when `data.section === "Create"`.

## Critical Rules

1. **Steps are sequential and NOT transactional.** If a step throws, everything created before it stays in Asana. There is no rollback.
2. **Firestore state is saved at Step 11 only.** A failure in Steps 3-10 leaves Asana artifacts that the Delete flow can only find via the legacy bridging-task search (and only if Step 10 completed). Do not move Step 11 later; consider moving it earlier when refactoring.
3. **The flow is not idempotent.** Re-sending the same Create payload duplicates both projects and overwrites the Firestore doc (orphaning the first set). Power Automate retries will cause duplicates.
4. **Two yacht-name variables exist.** `yachtName` (alias-resolved via `C.YACHT_ALIASES`, L40-42) is used for checkout template, maintenance, housekeeping, and Firestore. `detectBackToBack()` and the IN/OUT task names use raw `data.yacht_name`. Keep this in mind when adding aliases.
5. **Section placement is index-based**, not name-based (see table below). If the Asana template's section order changes, tasks land in the wrong section without error.
6. **Return contract:** `{ success: true, charterProjectGid, checkoutProjectGid, charterName }` or `{ success: false, error, brokerEmail }` (date validation only). `index.js` maps `success:false` to HTTP 400.

## Step Map
| Step | Lines | What happens | Asana / Firestore writes |
|---|---|---|---|
| 1 | `19-29` | `start_date > end_date` -> return failure (email is a `TODO`) | none |
| 2 | `31-35` | Captain/Chef name -> GID via `C.CAPTAINS` / `C.CHEFS` (unknown name -> `null`) | none |
| 3 | `37-58` | Tracking task on `BOARDS.CHARTER_INFO` with charter custom fields | 1 task |
| 4-5 | `60-75` | `C.CHARTER_TEMPLATES[charter_type]` -> `duplicateProject` -> set color. **Unknown type throws.** | 1 project |
| 6 | `77-87` | For up to 12 sections: create a charter-named task + `addTaskToSection(section, trackingTaskGid)` | up to 12 tasks |
| 7 | `89-121` | `addProjectMember(EDITOR_MEMBER)` (non-fatal), update first task in `sections[2]` (Charter Info) | 1 update |
| 8 | `123-151` | Text search Charter Info / Arrivals / Departures boards by `"charterName"` and update dates | up to 3 updates |
| 9-10 | `153-201` | Duplicate `CHECKOUT_TEMPLATES[yachtName] || default`, attach 13 custom fields, bridging task in both projects (notes = `"checkoutGid, charterGid"`) | 1 project, 1 task |
| 11 | `203-213` | `db.saveProvisioningState(charter_number, {...})` | Firestore doc |
| 12 | `215-217` | `createMaintenanceTasks()` - see [Maintenance & Housekeeping](skill-maintenance-housekeeping.md) | 7 tasks + subtasks |
| 13 | `219-221` | `createHousekeepingChecklists()` | 6 tasks + subtasks |
| 14 | `223-225` | `createInOutSchedule()` - DEPARTURE + ARRIVAL on IN/OUT board | 2 tasks |
| 15 | `227-229` | `detectBackToBack()` | 0-4 tasks |

## Section Index Assumptions
| Project | Index | Expected section | Used by |
|---|---|---|---|
| Charter project | `sections[2]` | Charter Info | Step 7 |
| Checkout project | `coSections[0]` | Untitled (debrief tasks) | Step 15 |
| Checkout project | `coSections[2]` | Vessel Prep Information | Step 15 |
| Checkout project | `coSections[6]` | Post - House Keeping Info | Step 13 |
| Checkout project | `coSections[7]` | Post - Maintenance Info | Step 12 |

Each lookup is guarded by a `length > N` check, so a shorter template **skips placement silently** rather than failing.

## IN/OUT Schedule (Step 14, L244-322)
- DEPARTURE task: `due_on = start_date`, type `IN_OUT_DEPARTURE`, name `"{client} | {yacht} | {boarding display} | - DEPARTURE"`.
- Searches IN/OUT board for same-yacht DEPARTURE tasks within +/-30 days of `end_date`; nearest future one gives `TURNAROUND_DAYS`.
- ARRIVAL task: `due_on = end_date`; type `IN_OUT_ARRIVAL_ALT` if turnaround <= 1 day, else `IN_OUT_ARRIVAL`.
- Day-of-week section placement uses `data.start_day_name` / `data.end_day_name` from `normalizePayload()` -> `C.DAY_SECTIONS`. These names come from the unreliable `DAY_GID_TO_NAME` map (see [Known Issues](skill-known-issues.md)).
- The search filters by `data.yacht_name_id`. If that is missing, `URLSearchParams` sends `"undefined"`.

## Back-to-Back Detection (Step 15, L329-415)
- Searches `BOARDS.CHARTER_INFO` for tasks with the same `YACHT_NAME` enum, excluding the current `charterName`.
- Closest previous charter (its `due_on` -> current `start_date`) and next charter (current `end_date` -> its `start_on`).
- Gap <= 7 days: "Previous/Next Charter Scheduled - {name}" in Vessel Prep section.
- Previous gap <= 3 days: "Pass on {yacht}   {prevClient} Debrief" + "Get Debrief {charterName}" in Untitled section. (Note the three spaces in the name - existing Asana convention; do not "fix" without checking downstream rules.)
- Client name is parsed from the charter name pattern `"Yacht | Client | Start | End"` - keep that format.

## Adding a New Step
1. Add it as a named async helper below `orchestrateNewCharter()`, not inline.
2. Call it with `log(N, "...")` so Cloud Logging shows `[Step N]`.
3. Coerce every optional value with `|| null` before passing to Asana custom fields or Firestore.
4. Wrap non-critical calls in `try/catch` + `logger.warn` (pattern used for `addProjectMember`). Let critical calls throw.
5. If the step creates artifacts, make sure [Charter Cleanup](skill-charter-cleanup.md) deletes them (store the GID in provisioning state or tag it with `CHARTER_NUMBER`).
6. Update the jump table in `README.md` if line ranges shift.
