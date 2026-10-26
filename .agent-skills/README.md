# Operation-Work-Flows - Agent Skills & Architecture Guide

Welcome, AI Agent. Before executing tasks on the **Operation-Work-Flows** (Charter Orchestration Engine) codebase, review the relevant skill file below so you can jump directly to the right code without redundant file scans or regressions.

**Every change in this repo creates, edits, or deletes real Asana projects and tasks in the live VOYAGE workspace.** There is no staging Asana. Read [Known Issues & Gotchas](skill-known-issues.md) before changing any flow.

---

## Core Skills Index

### Flows (Business Logic)
1. **[Charter Orchestration (Create Flow)](skill-charter-orchestration.md)** - The parallel 3-group (A->B->C) `orchestrateNewCharter()` pipeline: tracking task, template duplication, checkout project, Firestore state, IN/OUT board, back-to-back detection.
2. **[Charter Cleanup (Delete / Edit Flow)](skill-charter-cleanup.md)** - `deleteCharter()`, PRE-section unlinking, POST-section global deletion, re-bridging adjacent charters, and the Edit -> recreate + Maint + HK pipeline.
3. **[Maintenance & Housekeeping Provisioning](skill-maintenance-housekeeping.md)** - `maintenanceService.js` (`executeMaintenanceFlow`) and `housekeepingService.js` (`executeHousekeepingFlow`), plus bidirectional PRE/POST bridging (`7a` / `7b`).

### Data & Integrations
4. **[Payload Contract & normalizePayload()](skill-payload-contract.md)** - Inbound payload shape, enum resolution (`START_DAY_GIDS`, `END_DAY_GIDS`, `YACHT_NAME_GIDS`, `BOAT_TO_MODEL`), and `resolveYachtName()` alias resolution.
5. **[Asana API Wrapper](skill-asana-integration.md)** - `lib/asana.js` write concurrency semaphore (12 concurrent writes), 429 + 5xx retry backoff, batch subtask creation, and custom-field attachment.
6. **[Constants & GID Reference](skill-constants-and-gids.md)** - Every map in `config/constants.js`, `YACHT_ALIASES`, `resolveYachtName`, and `getYachtNameVariants`.
7. **[Firestore State](skill-firestore-state.md)** - Named Firestore database `"powerautomate"`, `provisioning_state`, `charter_audit_log`, `operation_locks`, and `pending_operations`.

### Operations & Quality
8. **[Deployment Workflow](skill-deployment-workflow.md)** - Firebase project `paynow-3f9dc`, codebase `charter-orchestrator`, env vars (`ASANA_PAT`, `WEBHOOK_API_KEY`), and safe deploy commands.
9. **[Testing Workflow](skill-testing-workflow.md)** - Create -> verify in Asana -> Delete cycle, far-future test dates, `TEST-` charter numbers, emulator caveats.
10. **[Known Issues & Gotchas](skill-known-issues.md)** - Resolved issues and remaining caveats. **Read before editing.**

---

## Critical Rules (Apply to Every Task)

1. **This is Firebase project `paynow-3f9dc` (VOYAGE Operations).** All Firestore state lives in the named database **`"powerautomate"`** (`getFirestore("powerautomate")`), NOT `(default)`.
2. **Asana is production.** The emulator still calls the real Asana API. Only test with far-future dates and `TEST-` charter numbers, and always run the Delete step afterwards.
3. **Never hardcode secrets.** `ASANA_PAT` and `WEBHOOK_API_KEY` come from `process.env` (`functions/.env`, which is gitignored). Do not paste the API key into skill files, commits, or test scripts.
4. **Never save `undefined` to Firestore** - the Admin SDK throws. Coerce optional fields with `|| null`.
5. **Yacht-name maps support aliases via `C.resolveYachtName()` and `C.getYachtNameVariants()`** (e.g., `"Miles Away"` <-> `"Miles Away II"`, `"Let it Go"` <-> `"Let It Go"`, `"Busy Bs"` <-> `"Busy B's"`).

---

## Line-Number Jump Table (Save Tool Calls)

### 1. `functions/index.js` (~594 lines)
| Lines | Section |
|---|---|
| `21-64` | `fireMaintAndHK()`, `processQueuedOperation()` (FIFO queue processor) |
| `69-192` | `validateRequired()`, `normalizePayload()`, `getDayName()` |
| `201-486` | `exports.charterEvents`: lock acquisition, `Create`, `Delete`, `Edit`, `Cancel` handlers + background Maint/HK + audit log updates |
| `497-540` | `exports.maintenanceEvents`: standalone Maintenance endpoint |
| `551-593` | `exports.housekeepingEvents`: standalone Housekeeping endpoint |

### 2. `functions/services/charterOrchestrator.js` (~656 lines)
| Lines | Section |
|---|---|
| `19-61` | `orchestrateNewCharter()`: date validation, crew GIDs, `resolveYachtName`, enum/template resolution |
| `67-119` | Group A: tracking task + charter/checkout template duplication + section polling |
| `124-199` | Group B: charter section tasks, tracking board updates, checkout sections |
| `201-360` | Group C: Step 7 custom-field resilient update, bridging task, schedule tasks, `createInOutSchedule()`, `detectBackToBack()` |
| `366-436` | Step 11: `maintPayload`, `hkPayload`, and `db.saveProvisioningState()` |
| `442-527` | `createInOutSchedule()` |
| `534-636` | `detectBackToBack()` |

### 3. `functions/services/charterCleaner.js` (~314 lines)
| Lines | Section |
|---|---|
| `40-96` | `deleteCharter()` Step 1: Firestore lookup + bridging task fallback (by name or `CHARTER_NUMBER`) |
| `98-167` | Steps 2-6: `unlinkPreTasksFromCheckout()`, `deletePostTasksFromCheckout()`, IN/OUT task delete, `deleteAllProjectTasks()`, project delete, `rebridgeAdjacentCharters()`, HubSpot callback |
| `174-223` | `rebridgeAdjacentCharters()` |
| `231-312` | `unlinkPreTasksFromCheckout()`, `deletePostTasksFromCheckout()`, `deleteAllProjectTasks()` |

### 4. `functions/services/maintenanceService.js` (~263 lines) & `housekeepingService.js` (~257 lines)
| File | Section |
|---|---|
| `maintenanceService.js` L32-255 | `executeMaintenanceFlow()`: genset tasks, Standard Jobs + subtasks, Yacht Schedule task, 7a/7b bidirectional bridging |
| `housekeepingService.js` L31-249 | `executeHousekeepingFlow()`: 6 stage parent tasks, batch subtasks, 7a/7b bidirectional bridging |

### 5. `functions/config/constants.js` (~565 lines) & `maintenance.js` (~345 lines)
| File | Section |
|---|---|
| `constants.js` L46-125 | `YACHT_ALIASES`, `YACHT_NAME_GIDS`, `resolveYachtName()`, `getYachtNameVariants()` |
| `constants.js` L135-565 | `HK_YACHT_SECTIONS`, `CUSTOM_FIELDS`, `CHARTER_TEMPLATES`, `CHARTER_TYPE_IDS`, `BOAT_TO_MODEL`, `YACHT_ACRONYMS`, `getFixedMaintTasks()` |
| `maintenance.js` L22-345 | `YACHT_MAINTENANCE`, `YACHT_STAGES`, `HOUSEKEEPING_LISTS`, `YACHT_HK_PROJECTS` |

---

## Full Codebase Structure

```
Operation-Work-Flows/
|-- .agent-skills/                     # This folder - agent skills & architecture guide
|-- .firebaserc                        # default project: paynow-3f9dc
|-- firebase.json                      # codebase "charter-orchestrator", disallowLegacyRuntimeConfig: true
|-- README.md                          # Human overview
|-- test_payload.json                  # Sample Create payload
`-- functions/
    |-- index.js                       # charterEvents, maintenanceEvents, housekeepingEvents (~594 lines)
    |-- package.json                   # Node 22, firebase-functions ^7, firebase-admin ^13
    |-- config/
    |   |-- constants.js               # Asana GIDs, YACHT_ALIASES, resolveYachtName (~565 lines)
    |   `-- maintenance.js             # YACHT_MAINTENANCE, YACHT_STAGES, YACHT_HK_PROJECTS (~345 lines)
    |-- lib/
    |   |-- asana.js                   # Asana REST wrapper with write semaphore + 429/5xx retry (~373 lines)
    |   |-- firestore.js               # "powerautomate" DB helpers, locks, queue, audit log (~365 lines)
    |   `-- rateTracker.js             # Asana RPM sliding window monitor (~170 lines)
    `-- services/
        |-- charterOrchestrator.js     # Parallel Group A/B/C Create flow (~656 lines)
        |-- charterCleaner.js          # Section-scoped Delete + adjacent charter re-bridging (~314 lines)
        |-- maintenanceService.js      # Standalone Maintenance provisioning + 7a/7b bridge (~263 lines)
        `-- housekeepingService.js     # Standalone Housekeeping provisioning + 7a/7b bridge (~257 lines)
```
