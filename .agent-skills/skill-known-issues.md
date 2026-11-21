# Known Issues & Gotchas Skill

## What This Is
Historical record of issues identified when the GitHub repository had drifted behind the deployed `rev105` Cloud Functions archive, plus how they were resolved on 2026-10-26.

---

## Resolved on 2026-10-26 (Restored `rev105` + Hardened Yacht Aliasing & Asana Resilience)

1. **Wrong Firestore Database (`(default)` vs `"powerautomate"`):**
   - **Root Cause:** Deploying the stale GitHub repo (`charterevents-00106-gug`) switched `lib/firestore.js` from `getFirestore("powerautomate")` to `admin.firestore()`, causing all `Edit` and `Delete` operations to miss `provisioning_state` and fail in `legacyDelete()`.
   - **Fix:** Restored `getFirestore("powerautomate")` across `lib/firestore.js` and `lib/rateTracker.js` (with a read/delete fallback to `(default)` in `getProvisioningState` / `deleteProvisioningState`).

2. **`Edit` Flow Only Deleted Without Recreating:**
   - **Root Cause:** The v1 `index.js` only called `deleteCharter()` on `Edit` and returned early when `legacyDelete` failed.
   - **Fix:** Restored `rev105` `Edit` pipeline in `index.js`: checks `db.getProvisioningState(charterNumber)`, deletes if found (or treats as `Create` if not found), runs `orchestrateNewCharter()`, and triggers `executeMaintenanceFlow()` + `executeHousekeepingFlow()` in the background while recording stage progress to `charter_audit_log`.

3. **Yacht Name Aliasing & Case Mismatches (`"Miles Away"` vs `"Miles Away II"`, `"Let it Go"` vs `"Let It Go"`):**
   - **Root Cause:** Incoming webhooks sent `"Miles Away"` and `"Let it Go"`, while config maps only had `"Miles Away II"` and `"Let It Go"`, causing `No maintenance project` and `No housekeeping stage hours` warnings.
   - **Fix:** Added `YACHT_ALIASES`, `resolveYachtName()`, and `getYachtNameVariants()` in `config/constants.js`, plus direct alias keys in `YACHT_NAME_GIDS`, `HK_YACHT_SECTIONS`, `BOAT_TO_MODEL`, `YACHT_ACRONYMS`, `SINGLE_GENSET_BOATS`, `YACHT_MAINTENANCE`, `YACHT_STAGES`, and `YACHT_HK_PROJECTS`, and multi-variant queries in `getPreviousCharter()` / `getNextCharter()`.

4. **Step 7 Custom Field Lag Crash (`Custom field with ID ... is not on given object`):**
   - **Root Cause:** Asana template duplication attaches custom fields asynchronously; occasionally `updateTask(charterInfoTaskGid, ...)` failed with HTTP 400 if a field wasn't attached yet.
   - **Fix:** Added automatic custom-field attachment + retry fallback in Step 7 of `services/charterOrchestrator.js`.

5. **Transient Asana 5xx (`502`/`503`/`504`) Errors & Rate Limits:**
   - **Fix:** `lib/asana.js` enforces a 12-slot write concurrency semaphore, retries HTTP 429 using `Retry-After`, and retries transient 5xx responses with backoff.

6. **`.env` Gitignore Protection:**
   - **Fix:** Added `.env` and `.env.*` to `functions/.gitignore` so secrets are never committed to GitHub.

---

## Resolved in Nov 2026 (Fleet Expansion, Rollback Guardrails & `[ASANA ERROR]` Reporting)

1. **Checkout `Post` Section Async Duplication Race (`dfda634`):**
   - **Root Cause:** Asana duplicates project sections asynchronously after `POST /projects/{template}/duplicate`; large `VOYAGE 590` Checkout projects occasionally hadn't populated `Post - Maintenance Info` / `Post - House Keeping Info` when Group B read sections once, leaving `maintSectionGid` / `hkSectionGid` `null`.
   - **Fix:** `charterOrchestrator.js` Group B now polls Checkout sections (up to `6 x 4s`) until `"Post - Maintenance"` exists, and both `maintenanceService.js` and `housekeepingService.js` perform a live Checkout section fallback lookup if `maintSectionGid` / `hkSectionGid` is missing. Backfilled all 16 `It's About Time` charters.

2. **Model-Based `CHECKOUT_COLORS` Enforcement (`dbf88bd`):**
   - **Root Cause:** Asana `PUT /projects/{gid}` uses write enum names (`"light-teal"` -> Turquoise `"blue-green"`, `"dark-red"` -> Red `"red"`). Without explicit update on Checkout duplication, new `VOYAGE 590` Checkouts inherited template defaults or wrong colors.
   - **Fix:** Added `CHECKOUT_COLORS` by model in `config/constants.js` and applied `asana.updateProject(checkoutProjectGid, { color: checkoutColor })` in Group B. Updated all 50 mismatched `VOYAGE 590`/`590e` Checkout projects to Turquoise.

3. **Fleet Onboarding & Fleet-Wide Turnaround Backfills (`d956c29`):**
   - **Vessels Onboarded:** `Sea Cat-Alyst` (`VOYAGE 590`, Dual Genset, `SA`), `It's About Time` (`VOYAGE 590` #18, Single Genset, `AT`), and `Liv The Dream` (`VOYAGE 510` #4, Single Genset, `LD`), plus full chronological turnaround backfills across all configured fleet charters (`Sea Cat-Alyst`, `It's About Time`, `Liv The Dream`, `Miles Away`, `Let It Go`, `Endless Summer`, and `The Drake`).

4. **`Sea Cat-Alyst` Consolidated Enum GID & Group A Rollback (`2a6badb`):**
   - **Root Cause:** Asana disabled `Sea Cat-Alyst` enum GID `1220097481120528` and renamed original enabled GID `1201359827957387` (`"Job Site"`) to `"Sea Cat-Alyst"`. Incoming webhooks/constants referencing the disabled GID failed Step 3 (`POST /tasks` 400) *after* concurrent template duplications had already spawned empty orphan projects.
   - **Fix:** Switched `Sea Cat-Alyst` to `1201359827957387`, gave `C.YACHT_NAME_GIDS` canonical precedence ahead of caller/stored `yacht_name_id`, changed Group A to create the `CHARTER_INFO` tracking task before duplicating templates via `Promise.allSettled` with rollback cleanup on failure, cleaned up all 12 orphan shells, and re-triggered `SA-S-92388`, `SA-S-91464`, and `SA-S-92387`.

5. **Explicit `[ASANA ERROR]` Webhook & Audit Telemetry (`f4f0edc`):**
   - **Root Cause:** Upstream Asana 4xx/5xx failures returned generic HTTP `500 Internal server error` without stamping `charter_audit_log`, buried offending GIDs inside 1,500-char Asana enum option dumps, and let background `Maint`/`HK` errors stamp final `success: true`.
   - **Fix:** Added `AsanaApiError` + `summarizeAsanaErrorBody()` in `lib/asana.js` and `buildErrorResponse()`, `buildValidationErrorBody()`, and `runBackgroundMaintAndHK()` in `index.js` so Asana failures push HTTP `502 ASANA Error` (`source: "ASANA"`, `error_type: "ASANA_ERROR"`, `asana_error`) and stamp structured error details in Cloud Run logs and `charter_audit_log`.
