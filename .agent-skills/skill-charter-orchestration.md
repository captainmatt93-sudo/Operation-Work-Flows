# Charter Orchestration (Create Flow) Skill

## What This Is
`orchestrateNewCharter(payload)` in `functions/services/charterOrchestrator.js` replaces legacy Power Automate Flows 1-7 using a **3-group parallel execution pipeline (Group A -> Group B -> Group C)**. After `orchestrateNewCharter()` returns and writes `provisioning_state`, `runBackgroundMaintAndHK()` in `functions/index.js` runs Maintenance (`executeMaintenanceFlow`) followed sequentially by Housekeeping (`executeHousekeepingFlow`) in the background.

## Critical Rules

1. **Group A fail-fast + rollback on template duplication:** Step 3 creates the `CHARTER_INFO` tracking task (`<1s`) *before* duplicating the Charter and Checkout templates via `Promise.allSettled`. Invalid custom-field/enum errors fail fast without creating orphan Asana project shells; if one template duplication fails, Group A deletes the tracking task and whichever project succeeded before throwing.
2. **Canonical `C.YACHT_NAME_GIDS` precedence:** `yachtNameId` always prefers `C.YACHT_NAME_GIDS[yachtName] || C.YACHT_NAME_GIDS[resolvedYacht]` over caller-supplied `data.yacht_name_id` so stale/disabled CRM enum GIDs never cause Asana 400 errors.
3. **Name-based `sectionMap` lookup (with polling):** Group A->B polls charter project sections up to 8x5s until `>= 3` named sections appear, and Group B polls checkout sections up to 6x4s until `"Post - Maintenance"` appears. Checkout color is enforced via `C.CHECKOUT_COLORS[yachtModel]` (`updateProject`).
4. **Per-charter serialization (`operation_locks` + `pending_operations`):** `charterEvents` acquires a Firestore lock before running `orchestrateNewCharter()` and queues concurrent webhooks (`202 Queued`) for background execution via `processQueuedOperation()`.
5. **Two yacht-name variables exist:** `resolvedYacht = C.resolveYachtName(yachtName)` is used for canonical GID/model/maint/HK lookups, while IN/OUT task titles preserve raw `data.yacht_name` or formatted `charterName`.
6. **Return contract:** `{ success: true, charterProjectGid, checkoutProjectGid, charterName, maintPayload, hkPayload }` or `{ success: false, error, brokerEmail }` (date validation failure -> HTTP `400 Validation Error`). Thrown `AsanaApiError` exceptions bubble to `charterEvents`, stamp `charter_audit_log`, and return HTTP `502 ASANA Error`.

## Execution Pipeline Map
| Stage / Group | Lines (`charterOrchestrator.js`) | What happens |
|---|---|---|
| Steps 1-2 & Enum Resolution | `24-61` | Date validation (`startDate > endDate` -> `400`), crew GIDs, `resolveYachtName`, canonical `yachtNameId`, `CHECKOUT_TEMPLATES[yachtModel]` |
| **Group A** (Step 3, then 5 & 9) | `63-135` | `CHARTER_INFO` tracking task first -> Charter & Checkout template duplication via `Promise.allSettled` (with rollback) -> `>= 3` section poll |
| **Group B** (Steps 5b-6, 8, 10a-b) | `137-271` | Create named charter section tasks (resolving `charterInfoTaskGid`), search & update `CHARTER_INFO`/`ARRIVALS`/`DEPARTURES` dates, poll checkout sections + apply `C.CHECKOUT_COLORS[yachtModel]` + add member |
| **Group C** (Steps 7, 10c-d, 14, 15) | `273-391` | Step 7 `attach/retry` custom fields on `charterInfoTaskGid`, `Check-Out | Check-In` bridging task, Check-In/Out schedule tasks, `createInOutSchedule()`, `detectBackToBack()` |
| Step 11 (`provisioning_state`) | `393-464` | Builds `maintPayload` & `hkPayload`, saves full state doc (`charter-{charterNumber}`) to Firestore `"powerautomate"` database |
| Background Maint -> HK | `index.js` `74-184` | `runBackgroundMaintAndHK()` runs `executeMaintenanceFlow` then `executeHousekeepingFlow`, recording per-stage metrics and final `success`/`error`/`errorSource` in `charter_audit_log` |

## IN/OUT Schedule (Step 14, `L470-564`)
- `DEPARTURE` task: `due_on = start_date`, type `IN_OUT_DEPARTURE`, name `"{client} | {yacht} | {boarding display} | - DEPARTURE"`.
- Searches IN/OUT board for same-yacht `DEPARTURE` tasks within `+/-30` days of `end_date`; nearest future one sets `TURNAROUND_DAYS`.
- `ARRIVAL` task: `due_on = end_date`; type `IN_OUT_ARRIVAL_ALT` if turnaround `<= 1` day, else `IN_OUT_ARRIVAL`.
- Day-of-week section placement uses `data.start_day_name` / `data.end_day_name` -> `C.DAY_SECTIONS`.

## Back-to-Back Detection (Step 15, `L570-684`)
- Searches `BOARDS.CHARTER_INFO` for tasks with the same `YACHT_NAME` enum (`yachtNameId`), excluding `charterName`.
- Gap `<= 7` days: creates `"Previous/Next Charter Scheduled - {name}"` in `Vessel Prep Information`.
- Previous gap `<= 3` days: creates `"Pass on {yacht}   {prevClient} Debrief"` + `"Get Debrief {charterName}"` in the top checkout section (preserve triple spaces).
- Client name is parsed from `"Yacht | Client | Start | End"` — keep that exact format.

## Adding a New Step
1. Add it as a named async helper below `orchestrateNewCharter()`, not inline.
2. Call it with `log(N, "...")` so Cloud Logging shows `[Step N]`.
3. Coerce every optional value with `|| null` before passing to Asana custom fields or Firestore.
4. Store any created GIDs in `db.saveProvisioningState()` so `charterCleaner.js` deletes them cleanly on `Edit`/`Delete`.
5. Update `.agent-skills/README.md` jump tables if line ranges shift significantly.
