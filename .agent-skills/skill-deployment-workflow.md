# Deployment Workflow Skill

## What This Is
How to configure, run, and deploy the Charter Orchestration Engine Cloud Function.

| Setting | Value | Source |
|---|---|---|
| Firebase project | `paynow-3f9dc` (VOYAGE Operations) | `.firebaserc` |
| Functions codebase | `charter-orchestrator` | `firebase.json` |
| Source dir | `functions/` | `firebase.json` |
| Runtime | Node.js 22, Cloud Functions v2 | `package.json`, `index.js` |
| Function | `charterEvents` (HTTP) | `index.js` |
| Region / timeout / memory | `us-east4` / 540 s / 512 MiB | `index.js` L108 |

## Critical Rules

1. **Never deploy to the Express Portal project** (`express-portal-service`). Always confirm with `npx firebase use` that the active project is `paynow-3f9dc` before deploying.
2. **Legacy runtime config is disabled** (`"disallowLegacyRuntimeConfig": true`). The README's `firebase functions:config:set ...` instructions are **outdated** - `functions.config()` is not used and will not work. Secrets come from environment variables.
3. **Scope the deploy to this codebase.** The `npm run deploy` script runs `firebase deploy --only functions`, which targets every codebase in `firebase.json`. Prefer:
   ```bash
   npx firebase deploy --only functions:charter-orchestrator
   ```
4. **Do not change the function name or region** without updating the Power Automate/HubSpot caller - the URL changes and live bookings stop provisioning.
5. **Never commit `.env*` files with real values.** `functions/.gitignore` only ignores `node_modules/` and `*.local`, so a plain `functions/.env` **would be committed**. Use `.env.local` for emulator values or Secret Manager for production.

## Environment Variables
| Var | Used in | Missing effect |
|---|---|---|
| `ASANA_PAT` | `lib/asana.js` `getHeaders()` | Every Asana call throws `ASANA_PAT environment variable is not set` -> 500 |
| `WEBHOOK_API_KEY` | `index.js` handler | Every request returns 401 |

Recommended production setup (Secret Manager):
```bash
npx firebase functions:secrets:set ASANA_PAT
npx firebase functions:secrets:set WEBHOOK_API_KEY
```
Then bind them in code: `onRequest({ region: "us-east4", ..., secrets: ["ASANA_PAT", "WEBHOOK_API_KEY"] }, handler)`.
**Check the currently deployed function before changing this** (Cloud Console -> Cloud Run -> `charterevents` -> Variables & Secrets) so you keep whatever mechanism is already live.

## Local Setup
```bash
cd functions
npm install
# create functions/.env.local (git-ignored) with ASANA_PAT=... and WEBHOOK_API_KEY=...
npm run serve        # firebase emulators:start --only functions
```
Emulator URL: `http://127.0.0.1:5001/paynow-3f9dc/us-east4/charterEvents`

> The emulator runs functions locally but **Asana calls are real** and Firestore writes go to production unless the Firestore emulator is also running (`firebase emulators:start --only functions,firestore`).

## Deploy Checklist
1. `git pull` and confirm you are on `main` with a clean tree.
2. `npx firebase use` -> must show `paynow-3f9dc`.
3. Syntax-check changed files (do not `require()` `index.js` directly - it calls `initializeApp()`):
   ```powershell
   Get-ChildItem functions -Recurse -Filter *.js -Exclude node_modules | Where-Object FullName -notmatch "node_modules" | ForEach-Object { node --check $_.FullName }
   ```
4. Run the [Testing Workflow](skill-testing-workflow.md) against the emulator.
5. `npx firebase deploy --only functions:charter-orchestrator`
6. Re-run the test cycle against the deployed URL and confirm cleanup.
7. Watch logs: `npx firebase functions:log --only charterEvents`.

## Logs
- Create steps log as `[Step N] ...`; Delete steps as `[Delete Step N] ...`.
- Filter in Cloud Logging by `resource.labels.service_name="charterevents"`.
- Warnings (`logger.warn`) indicate swallowed failures - a 200 response can still contain them.

## README Drift (fix when touching README)
- Setup step uses deprecated `functions:config:set`.
- Project structure omits `config/maintenance.js`.
- States 8 flows replaced; code comments say Flows 1-7 (create) + Flow 8 (delete) - consistent, but keep wording aligned.
