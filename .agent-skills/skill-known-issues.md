# Known Issues & Gotchas Skill

## What This Is
Verified problems in the current code (commit `dc0447f`, `origin/main`). Each entry lists where it is, the impact, and the safe fix direction. **Check this list before editing a flow** - several "obvious" bugs interact with live Asana data, so fix them deliberately, one at a time, with a test cycle.

When you fix an issue, move its row to the "Resolved" section at the bottom with the commit hash.

## High Impact

### 1. `DAY_GID_TO_NAME` is unreliable (`index.js` L14-30)
- The map has no Friday entry in the first block, maps `1201397001797731` to `"Thursday"` (two Thursdays), and has a second block in non-sequential order.
- `test_payload.json` sends start `2026-10-15` / end `2026-10-22` (both **Thursdays**) with day GIDs the map resolves to **Sunday**.
- Express Portal docs list Friday GIDs `1201397001797806` (start) / `1201397057046823` (end), which are not in the map.
- **Impact:** IN/OUT DEPARTURE/ARRIVAL tasks land in the wrong day section.
- **Safe fix:** derive the day name from the date (`getDayName(start_date)`) first, and only use the GID for the custom field value. Confirm the real enum options via `GET /custom_fields/1201397001788498` (START_DAY) and `/1201397057037367` (END_DAY).

### 2. Create flow is not idempotent / not transactional (`charterOrchestrator.js`)
- Duplicate Create payloads duplicate projects; mid-flow failure leaves partial artifacts.
- **Safe fix:** at the start of Create, `getProvisioningState(charter_number)` and abort (or delete-then-recreate) if it exists. Consider saving a "pending" state right after Step 5.

### 3. Step 6 adds the tracking task to charter sections (`charterOrchestrator.js` L81-87)
- Loop creates a charter-named task in the project but discards its GID, then calls `addTaskToSection(sections[i].gid, trackingTaskGid)` with the **tracking task** (which lives on Charter Info board, not this project).
- **Impact:** created tasks stay in the default section; tracking-task section moves either fail or move it repeatedly (last wins).
- **Safe fix:** confirm intended behaviour against the legacy flow, then likely `addTaskToSection(sections[i].gid, created.data.gid)`.

### 4. `searchTasks` does not strip null/undefined (`lib/asana.js` L160-167)
- `URLSearchParams` turns `undefined` into `"undefined"`. Missing `yacht_name_id` breaks IN/OUT turnaround and back-to-back searches silently.
- **Safe fix:** filter params in `searchTasks`: `Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))`.

### 5. Master-board deletes not wrapped in try/catch (`charterCleaner.js` L104-132, L204-214)
- One failed delete aborts the run before Firestore cleanup -> 500 and stale state.
- **Safe fix:** wrap each `deleteTask` like L80.

## Medium Impact

### 6. HK notes contain `[object Object]` (`charterOrchestrator.js` L534)
- `data.boarding_time` is usually `{ display, gid }`. Use `data.boarding_time_display`.

### 7. Custom field GID collision: `YACHT_MODEL` == `SALESFORCE_ID` (`constants.js` L22, L56)
- Both `1200070937070496`. Verify the real Yacht Model field GID in Asana.

### 8. Crew GID collision: `CHEFS["Nia Mora"]` == `CAPTAINS["Tony Cook"]` (`1201527061283020`)
- One is wrong. Verify in Asana users.

### 9. `MAINTENANCE_PROJECTS` is stale and unused (`constants.js` L103-132)
- GIDs are offset from `maintenance.js` (e.g. `930228245617935` is "Endless Summer" here but "Electrified" in `YACHT_MAINTENANCE`). Anyone using it will multi-home tasks into the wrong yacht. Prefer removing it or marking it deprecated.

### 10. No pagination on `getSectionTasks` / `searchTasks`
- Only the first page (default 100 for search) is processed. Sections with more tasks are partially deleted in cleanup.

### 11. Yacht coverage gaps (`maintenance.js`)
- `"Out Of Office"`: stages only (no maintenance, no acronym). `"Electrified"`: maintenance only (no stages). Missing entries skip provisioning silently.

### 12. Deleting the checkout project clears all sections (`charterCleaner.js` L36-48)
- Any manually added or bridged tasks in the checkout project are deleted too. The Express Portal skill describes a section-scoped delete; that version is not in this repo.

## Low Impact / Hygiene

| # | Issue | Location |
|---|---|---|
| 13 | `EDITOR_MEMBER` stale; add-member always warns | `constants.js` L7 |
| 14 | Date-validation failure email is a `TODO` - broker is never notified | `charterOrchestrator.js` L27 |
| 15 | HubSpot callback URL hardcoded | `charterCleaner.js` L142 |
| 16 | `README.md` setup uses deprecated `functions:config:set`; structure omits `maintenance.js` | `README.md` |
| 17 | Mojibake in `package.json` description (`?"` instead of a dash) | `functions/package.json` |
| 18 | Unused exports: `MAINT_CREW`, `SECTION_ACTION`, `batchCreateTasks`, `removeTaskFromProject`, `getProject`, Firestore config readers | various |
| 19 | `npm run deploy` deploys all codebases, not just `charter-orchestrator` | `functions/package.json` |
| 20 | `functions/.gitignore` does not ignore `.env` (only `*.local`) | `functions/.gitignore` |
| 21 | `firebase-functions-test` installed but no tests exist | `functions/package.json` |

## Express Portal Documentation Drift (do not edit Express - reference only)
The Express Portal repo's `skill-operation-work-flows.md` describes features that are **not** in this repo: `maintenanceEvents` / `housekeepingEvents` endpoints, `maintenanceService.js`, `housekeepingService.js`, `firestore.indexes.json`, `START_DAY_GIDS` / `END_DAY_GIDS` / `YACHT_NAME_GIDS` / `BOAT_TO_MODEL` auto-resolution, null-stripping `searchTasks`, and section-scoped checkout deletes. If that code exists elsewhere (e.g. another machine), it has not been pushed to `captainmatt93-sudo/Operation-Work-Flows`. Treat **this repo's code** as the source of truth for these skills.

---

## Resolved
| # | Issue | Commit |
|---|---|---|
| - | - | - |
