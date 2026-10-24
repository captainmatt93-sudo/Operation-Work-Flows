# Operation-Work-Flows - Agent Skills & Architecture Guide

Welcome, AI Agent. Before executing tasks on the **Operation-Work-Flows** (Charter Orchestration Engine) codebase, review the relevant skill file below so you can jump directly to the right code without redundant file scans or regressions.

**Every change in this repo creates, edits, or deletes real Asana projects and tasks in the live VOYAGE workspace.** There is no staging Asana. Read [Known Issues & Gotchas](skill-known-issues.md) before changing any flow.

---

## Core Skills Index

### Flows (Business Logic)
1. **[Charter Orchestration (Create Flow)](skill-charter-orchestration.md)** - The 15-step `orchestrateNewCharter()` pipeline: tracking task, template duplication, checkout project, Firestore state, IN/OUT board, back-to-back detection.
2. **[Charter Cleanup (Delete / Edit Flow)](skill-charter-cleanup.md)** - `deleteCharter()`, legacy bridging-task fallback, master board cleanup, and the Edit -> HubSpot re-create callback.
3. **[Maintenance & Housekeeping Provisioning](skill-maintenance-housekeeping.md)** - Steps 12-13: fixed maintenance tasks, `@Standard Jobs`, A/B/C interior/exterior checklists, pay calc, and how to add a new yacht.

### Data & Integrations
4. **[Payload Contract & normalizePayload()](skill-payload-contract.md)** - Inbound Power Automate payload shape, quirks (`'""'` crew, GID day fields, `boarding_time` object), and field aliases.
5. **[Asana API Wrapper](skill-asana-integration.md)** - `lib/asana.js` functions, project duplication job polling, search params, section-index placement, and rate limiting.
6. **[Constants & GID Reference](skill-constants-and-gids.md)** - Every map in `config/constants.js`, which maps are keyed by yacht name, and which are stale/unused.
7. **[Firestore State](skill-firestore-state.md)** - `provisioning_state` collection, doc ID format, what is saved and when, and unused config readers.

### Operations & Quality
8. **[Deployment Workflow](skill-deployment-workflow.md)** - Firebase project `paynow-3f9dc`, codebase `charter-orchestrator`, env vars (`ASANA_PAT`, `WEBHOOK_API_KEY`), and safe deploy commands.
9. **[Testing Workflow](skill-testing-workflow.md)** - Create -> verify in Asana -> Delete cycle, far-future test dates, `TEST-` charter numbers, emulator caveats.
10. **[Known Issues & Gotchas](skill-known-issues.md)** - Verified bugs, data collisions, and silent-failure traps in the current code. **Read before editing.**

---

## Critical Rules (Apply to Every Task)

1. **This is Firebase project `paynow-3f9dc` (VOYAGE Operations).** It is NOT the Express Portal project. Never deploy one into the other.
2. **Asana is production.** The emulator still calls the real Asana API. Only test with far-future dates and `TEST-` charter numbers, and always run the Delete step afterwards.
3. **Never hardcode secrets.** `ASANA_PAT` and `WEBHOOK_API_KEY` come from `process.env`. Do not paste the API key into skill files, commits, or test scripts.
4. **Never save `undefined` to Firestore** - the Admin SDK throws. Coerce optional fields with `|| null`.
5. **Never pass `undefined` into `asana.searchTasks()`** - `URLSearchParams` serializes it as the literal string `"undefined"` and the search silently returns wrong/empty results.
6. **Yacht-name maps must match exactly** (case, apostrophes, spacing). Resolve aliases via `C.YACHT_ALIASES` first. See [Constants](skill-constants-and-gids.md).
7. **Checkout/charter task placement depends on section index** (`sections[2]`, `[6]`, `[7]`). Changing an Asana template's section order silently misplaces tasks.
8. **Keep Asana calls sequential** with the existing small delays. Do not convert loops to `Promise.all` - it trips Asana rate limits mid-flow and leaves partial projects.
9. **Use plain ASCII in source and docs** where possible (no smart quotes / em dashes). `package.json` already contains a mojibake character.

---

## Line-Number Jump Table (Save Tool Calls)

### 1. `functions/services/charterOrchestrator.js` (~602 lines)
| Lines | Section |
|---|---|
| `15-29` | `orchestrateNewCharter()` entry + Step 1 date validation |
| `31-58` | Step 2 crew GIDs, Step 3 tracking task (+ `YACHT_ALIASES` resolution at L40-42) |
| `60-87` | Steps 4-6: template lookup, `duplicateProject`, per-section tasks |
| `89-121` | Step 7: editor member + Charter Info task update (`sections[2]`) |
| `123-151` | Step 8: Charter Info / Arrivals / Departures board date sync |
| `153-201` | Steps 9-10: checkout project duplication, `ensureProjectCustomFields`, bridging task |
| `203-238` | Steps 11-15: Firestore save, maintenance, housekeeping, IN/OUT, back-to-back, return |
| `244-322` | `createInOutSchedule()` - DEPARTURE/ARRIVAL tasks, turnaround days, day sections |
| `329-415` | `detectBackToBack()` - Previous/Next Charter Scheduled (<=7d), debrief tasks (<=3d) |
| `422-507` | `createMaintenanceTasks()` - fixed tasks, `@Standard Jobs`, Yacht Schedule board |
| `514-585` | `createHousekeepingChecklists()` - 6 stage parents + subtasks, pay calc |
| `589-601` | `daysBetween()`, `addDays()` helpers + export |

### 2. `functions/config/maintenance.js` (~303 lines)
| Lines | Section |
|---|---|
| `7-18` | `STANDARD_JOBS_DEFAULT`, `STANDARD_JOBS_WITH_BATTERY` |
| `22-50` | `YACHT_MAINTENANCE` (project GID, Yacht Schedule section, job list per yacht) |
| `56-84` | `YACHT_STAGES` (housekeeping A/B/C hours per yacht) |
| `90-178` | `INTERIOR_A` / `INTERIOR_B` / `INTERIOR_C` checklists |
| `180-287` | `EXTERIOR_A` / `EXTERIOR_B` / `EXTERIOR_C` checklists |
| `289-302` | `HOUSEKEEPING_LISTS` + exports |

### 3. `functions/config/constants.js` (~269 lines)
| Lines | Section |
|---|---|
| `5-17` | Workspace, team, editor member, `BOARDS` |
| `20-79` | `CUSTOM_FIELDS` (field GIDs and enum option GIDs) |
| `82-100` | `CHARTER_TEMPLATES`, `CHECKOUT_TEMPLATES` |
| `103-132` | `MAINTENANCE_PROJECTS` (**unused / stale** - see Known Issues) |
| `135-177` | `DAY_SECTIONS`, `CAPTAINS`, `CHEFS`, `BROKERS` |
| `180-233` | `YACHT_ACRONYMS`, `YACHT_ALIASES` |
| `236-268` | `MAINT_CREW`, `FIXED_MAINT_TASKS`, exports |

### 4. `functions/index.js` (~172 lines)
| Lines | Section |
|---|---|
| `14-30` | `DAY_GID_TO_NAME` (**unreliable** - see Known Issues) |
| `53-98` | `normalizePayload()`, `getDayName()` |
| `107-171` | `charterEvents` HTTP handler: method check, API key, Create/Delete/Edit switch |

---

## Full Codebase Structure

```
Operation-Work-Flows/
|-- .agent-skills/                     # This folder - agent skills & architecture guide
|-- .firebaserc                        # default project: paynow-3f9dc
|-- firebase.json                      # codebase "charter-orchestrator", disallowLegacyRuntimeConfig: true
|-- README.md                          # Human overview (partially outdated - see skill-deployment-workflow.md)
|-- test_payload.json                  # Sample Create payload (Southern Cross / SC-00259)
`-- functions/
    |-- index.js                       # charterEvents HTTP endpoint + normalizePayload() (~172 lines)
    |-- package.json                   # Node 22, firebase-functions ^7, firebase-admin ^13
    |-- config/
    |   |-- constants.js               # Asana GIDs: boards, custom fields, templates, crew, acronyms (~269 lines)
    |   `-- maintenance.js             # YACHT_MAINTENANCE, YACHT_STAGES, housekeeping checklists (~303 lines)
    |-- lib/
    |   |-- asana.js                   # Asana REST wrapper (fetch + PAT) (~217 lines)
    |   `-- firestore.js               # provisioning_state helpers + unused config readers (~93 lines)
    `-- services/
        |-- charterOrchestrator.js     # Create flow, Steps 1-15 (~602 lines)
        `-- charterCleaner.js          # Delete/Edit flow, Steps 1-6 + legacyDelete() (~220 lines)
```

---

## Archive

Superseded skill files go in [`archive/`](archive/) rather than being deleted, so historical context is preserved.
