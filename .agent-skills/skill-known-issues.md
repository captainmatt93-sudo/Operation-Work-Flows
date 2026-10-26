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
