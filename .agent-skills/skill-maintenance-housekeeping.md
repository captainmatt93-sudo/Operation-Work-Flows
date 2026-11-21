# Maintenance & Housekeeping Provisioning Skill

## What This Is
Standalone Maintenance (`functions/services/maintenanceService.js` -> `executeMaintenanceFlow()`) and Housekeeping (`functions/services/housekeepingService.js` -> `executeHousekeepingFlow()`) services run sequentially in the background after `orchestrateNewCharter()`, and can also be invoked standalone via `/maintenanceEvents` and `/housekeepingEvents`. Both are driven by `functions/config/maintenance.js` (`M`) and `functions/config/constants.js` (`C`).

## Critical Rules

1. **Alias resolution + canonical `yachtNameId` precedence:** Both services normalize incoming `yachtName` via `C.resolveYachtName(yachtName)` and always prefer `C.YACHT_NAME_GIDS` over any stale `rawYachtNameId` saved in `maintPayload` / `hkPayload`.
2. **A missing yacht skips cleanly:** Missing `maintProjectGid` -> `{ success: false, error: "No maintenance project configured" }`. Missing `stageHours` -> `{ success: false, error: "No housekeeping stage config" }`. Both are recorded onto `charter_audit_log` by `runBackgroundMaintAndHK()`.
3. **Source of truth for maintenance project GIDs is `M.YACHT_MAINTENANCE[yacht].project`.** `C.MAINTENANCE_PROJECTS` in `constants.js` is legacy - do not use it.
4. **Live section fallback & Turn Around Jobs matching:** If `maintSectionGid` or `hkSectionGid` wasn't captured during initial Checkout duplication, both services fetch Checkout sections live and match `Post - Maintenance` / `Post - House`. `Turn Around Jobs` sections are matched case-insensitively (`s.name.trim().toLowerCase() === "turn around jobs"`).
5. **Subtask creation:** Maintenance uses `asana.createSubtasksWithWorkers(gid, list, 3)` (~3-4 jobs). Housekeeping uses `asana.batchCreateSubtasks()` (181 items across 6 stages, batched 10 per `/batch` call with 500ms delay).

## `executeMaintenanceFlow()` (`functions/services/maintenanceService.js` L33-280)
1. Determines genset type via `C.getFixedMaintTasks(yachtName, yachtModel)`:
   - **Dual Genset (`7` fixed + `Standard Jobs` = `8` Checkout tasks):** `FIXED_MAINT_TASKS_DUAL` (*Service port genset*, *Service stb genset*, *Wash port and stb engine rooms*, *Clean Genset Engine strainers*, *Port and stb engine checks*, *Systems check*, *Rigging check and lubrication*).
   - **Single Genset (`6` fixed + `Standard Jobs` = `7` Checkout tasks):** `FIXED_MAINT_TASKS_SINGLE` (models `VOYAGE 480`/`480e`, `510`/`510e`, `520` plus `SINGLE_GENSET_BOATS`: `The Drake`, `Miles Away II`, `Decent Effort`, `It's About Time`, `Liv The Dream`).
2. Looks up `BOARDS.MECHANICAL_PROJECT` (`"Service Due..."`), `maintProjectGid` (`"Turn Around Jobs"`), and live Checkout `Post - Maintenance` fallback concurrently.
3. Creates fixed tasks concurrently with multi-project memberships (Evergreen Maint Project `Turn Around Jobs` + Checkout `Post - Maintenance Info` + `MECHANICAL_PROJECT` for Mech tasks) and `due_on = endDate`.
4. Creates `Standard Jobs` + subtasks via `createSubtasksWithWorkers()`.
5. If `charterSection` is set, creates a charter-named tracking task on `BOARDS.YACHT_SCHEDULE` (total `tasksCreated`: **9** dual-genset / **8** single-genset).
6. **Steps 7a + 7b (Bidirectional `Pre`/`Post` Bridge):** Concurrently pulls previous charter's `Post - Maintenance` tasks -> current `Pre - Maintenance` (via `db.getPreviousCharter`), and clears + pushes current tasks -> next charter's `Pre - Maintenance` (via `db.getNextCharter`).

## `executeHousekeepingFlow()` (`functions/services/housekeepingService.js` L31-267)
1. Resolves `stageHours` (`M.YACHT_STAGES`), `acronym` (`C.YACHT_ACRONYMS`), `hkProjectGid` (`M.YACHT_HK_PROJECTS`), and `yachtScheduleSection` (`C.HK_YACHT_SECTIONS`).
2. Looks up `Turn Around Jobs` on `hkProjectGid` and live Checkout `Post - House` fallback concurrently.
3. Builds 6 stage configs (`Interior A/B/C`, `Exterior A/B/C`, `181` total subtasks across `M.HOUSEKEEPING_LISTS`), creates all 6 parent tasks concurrently (`{acronym} | {clientShort}, {Interior|Exterior} {A|B|C}`) across `HK_YACHT_SCHEDULE`, Checkout `Post - House Keeping Info`, `HK_STAGE_PROJECT`, and `hkProjectGid` (`Turn Around Jobs`). Note: Cloned HK projects may also run native Asana Rules moving tasks into `STAGE A`/`B`/`C` sections.
4. Populates the 181 checklist subtasks via `asana.batchCreateSubtasks()`.
5. **Steps 7a + 7b (Bidirectional `Pre`/`Post` Bridge):** Concurrently links previous charter's `Post - House` tasks -> current `Pre - House-Keeping Info` and clears + links current 6 tasks -> next charter's `Pre - House-Keeping Info`.

## Yacht Coverage Matrix (keep in sync)
A yacht needs entries in every map below to be fully provisioned:

| Map | File | Missing entry effect |
|---|---|---|
| `YACHT_NAME_GIDS` | `constants.js` | Missing/wrong `Yacht Name` enum on Tracking, Charter Info, Maint & HK tasks |
| `YACHT_ALIASES` | `constants.js` | External CRM name variants don't resolve to canonical maps or multi-variant queries |
| `BOAT_TO_MODEL` | `constants.js` | No model-specific Checkout template, `CHECKOUT_COLORS`, or `Yacht Model` custom field |
| `YACHT_ACRONYMS` | `constants.js` | Schedule & HK task names use first 3 letters |
| `SINGLE_GENSET_BOATS` | `constants.js` | 590/580 boat defaults to dual genset (`Service port/stb genset`) unless listed here |
| `YACHT_MAINTENANCE` | `maintenance.js` | Maintenance flow returns `{ success: false, error: "No maintenance project configured" }` |
| `YACHT_STAGES` | `maintenance.js` | Housekeeping flow returns `{ success: false, error: "No housekeeping stage config" }` |
| `YACHT_HK_PROJECTS` | `maintenance.js` | HK tasks are still created on Checkout/Master boards, but not added to vessel HK project |
| `HK_YACHT_SECTIONS` | `constants.js` | HK tasks land on `HK_YACHT_SCHEDULE` without a vessel section |

## How To Add a New Yacht
1. Get the yacht's maintenance project GID and (optional) Yacht Schedule section GID from Asana.
2. Add to `YACHT_MAINTENANCE` with `STANDARD_JOBS_DEFAULT` or `STANDARD_JOBS_WITH_BATTERY`.
3. Add A/B/C hours to `YACHT_STAGES`.
4. Add an acronym to `YACHT_ACRONYMS`.
5. If the booking system sends a different name, add `"External Name": "Internal Name"` to `YACHT_ALIASES`.
6. If it needs a non-default checkout template, add it to `CHECKOUT_TEMPLATES`.
7. Use the **exact same spelling** in every map. Run the Testing Workflow with that yacht before deploying.

## Editing Checklists
- Checklist arrays are flat: heading lines and detail lines are both subtasks. Preserve order - it is the order crews see.
- Edit in plain ASCII. Avoid smart quotes and em dashes (mojibake risk).
- Changes only affect charters created after deploy; existing checkout projects are not updated.

### Default Maintenance Task Assignees (`MAINT_CREW`)
- **Mechanical tasks** (`dept: "1199963408496827"` — *Service genset*, *Service port/stb genset*, *Wash port and stb engine rooms*, *Clean genset strainer*, *Check port and stb engines*): **David St. Clair** (`MAINT_CREW.DAVID_ST_CLAIR` = `"732999672531073"`).
- **Rigging tasks** (`dept: "1199963408496828"` — *Rigging check and lubrication*): **Sherlock Hartman** (`MAINT_CREW.SHERLOCK_HARTMAN` = `"130812572926108"`).
- **Systems check & Standard Jobs** (`dept: "1199963408496830"`): `captainGid || null` (assigned to the Captain if present on the charter, otherwise unassigned).
- **Turn Around Jobs section matching**: Case-insensitive (`s.name.trim().toLowerCase() === "turn around jobs"`) across both `maintenanceService.js` and `housekeepingService.js`.
