# Maintenance & Housekeeping Provisioning Skill

## What This Is
Steps 12 and 13 of the Create flow (`charterOrchestrator.js` L422-585) populate the new checkout project with maintenance and housekeeping work, driven by the static config in `functions/config/maintenance.js` and `FIXED_MAINT_TASKS` in `constants.js`.

## Critical Rules

1. **Lookups use the alias-resolved `yachtName`** (e.g. `"Miles Away II"` -> `"Miles Away"`). Keys must match exactly, including apostrophes: `"Busy B's"`, `"5 O'Clock Somewhere"`.
2. **A missing yacht is a silent skip.** No `YACHT_MAINTENANCE` entry -> `logger.warn` + no maintenance tasks. No `YACHT_STAGES` entry -> no housekeeping tasks. The request still returns 200.
3. **Source of truth for maintenance project GIDs is `M.YACHT_MAINTENANCE[yacht].project`.** `C.MAINTENANCE_PROJECTS` in `constants.js` is unused and its GIDs do not line up with `maintenance.js` - do not use it.
4. **Subtask creation is throttled** with a 150 ms delay. Keep it. A full run creates roughly 7 maintenance tasks + subtasks and 6 HK parents + ~200 subtasks.

## Step 12 - `createMaintenanceTasks()` (L422-507)
1. Reads `{ project, jobs, charterSection }` from `M.YACHT_MAINTENANCE[yachtName]`.
2. Target section: checkout `coSections[7]` ("Post - Maintenance Info").
3. Creates each of the 6 `C.FIXED_MAINT_TASKS`:
   - `assignee`: the fixed crew GID, or the captain GID when `assignee: null` (`@System Check`).
   - Common fields: Priority High, Type Preventative, Yacht Name, Charter Number, Total Time 0, plus Department and Hours.
   - `due_on = end_date`; placed in section 7; multi-homed into the yacht's maintenance project via `addTaskToProject`.
4. Creates `@Standard Jobs` (assigned to captain, Dept General) and one subtask per entry in `jobs`.
5. If `charterSection` is truthy, creates a charter-named task on `BOARDS.YACHT_SCHEDULE`. (Note: `charterSection` is only used as a flag; the task is not placed into that section.)

## Step 13 - `createHousekeepingChecklists()` (L514-585)
1. Reads `{ A, B, C }` hours from `M.YACHT_STAGES[yachtName]`.
2. Target section: checkout `coSections[6]` ("Post - House Keeping Info").
3. Acronym: `C.YACHT_ACRONYMS[yachtName]` or first 3 chars of the name.
4. Creates 6 parent tasks: Interior A/B/C, Exterior A/B/C, named `"{acronym} | {clientShort}, {Interior|Exterior} {A|B|C}"`.
5. Custom fields: Prescribed Time (hours), Cleaning Stage enum, Int/Ext enum, Yacht Name, Charter Number, Pay (`hours * 18.75`), Yacht Model (`data.yacht_model_id || null`).
6. One subtask per checklist line from `M.HOUSEKEEPING_LISTS`.
7. Notes: `"{checkoutGid} | {charterName} | {boarding_time} | {charter_number}"` - see Known Issues: `boarding_time` is usually an object here.

## Yacht Coverage Matrix (keep in sync)
A yacht needs entries in several maps to be fully provisioned:

| Map | File | Missing entry effect |
|---|---|---|
| `YACHT_MAINTENANCE` | maintenance.js | No maintenance tasks, no Yacht Schedule task |
| `YACHT_STAGES` | maintenance.js | No housekeeping tasks |
| `YACHT_ACRONYMS` | constants.js | HK task names use first 3 letters |
| `CHECKOUT_TEMPLATES` | constants.js | Falls back to `default` template |
| `YACHT_ALIASES` | constants.js | Only needed if the external name differs |

Known gaps today: `"Out Of Office"` has stages but no maintenance entry or acronym; `"Electrified"` has maintenance but no stages.

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
