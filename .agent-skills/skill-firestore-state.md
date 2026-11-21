# Firestore State Skill

## What This Is
`functions/lib/firestore.js` stores per-charter provisioning state, operation locks, pending retry queues, and live audit telemetry in the **named Firestore database `"powerautomate"`** (`getFirestore("powerautomate")`) on project `paynow-3f9dc`. *(Reads/deletes on `provisioning_state` also check `(default)` as a legacy fallback.)*

## Critical Rules

1. **Always use `"powerautomate"`, NOT `(default)`.** `getDb()` calls `getFirestore("powerautomate")`.
2. **Never write `undefined`.** The Admin SDK throws `Cannot use "undefined" as a Firestore value`. Coerce optional values with `|| null` before writing.
3. **Doc ID is `charter-{charter_number}`.** A missing `charter_number` produces `charter-undefined`.
4. **Per-charter serialization:** `acquireOperationLock()` / `enqueueOperation()` prevent concurrent `Create`/`Edit`/`Delete` webhooks for the same charter from colliding. Locks expire after 10 minutes (`LOCK_TTL_MS`), max queue depth is `3`.
5. **`admin.initializeApp()` is called once in `index.js`.** Do not call it again in lib modules.

## Collections & Schemas

### 1. `provisioning_state/charter-{charter_number}`
| Field | Type | Source / Purpose |
|---|---|---|
| `charterNumber` | string | `data.charter_number` |
| `charterName` | string | `"Yacht \| Client \| Start \| End"` |
| `charterProjectGid` | string | Group A charter project GID |
| `checkoutProjectGid` | string | Group A checkout project GID |
| `bridgingTaskGid` | string | Group C bridging task GID |
| `trackingTaskGid` | string | Group A `CHARTER_INFO` task GID |
| `depTaskGid`, `arrTaskGid` | string \| null | IN/OUT `DEPARTURE` and `ARRIVAL` task GIDs |
| `yachtName` | string | Charter yacht name (matched via `getYachtNameVariants` in `getPreviousCharter`/`getNextCharter`) |
| `startDate`, `endDate` | string | `YYYY-MM-DD` (used for chronological `Pre`/`Post` bridging queries) |
| `sectionMap` | map | Section name -> GID map for the checkout project |
| `maintPayload` | map | Input payload for `executeMaintenanceFlow()` / `/maintenanceEvents` |
| `hkPayload` | map | Input payload for `executeHousekeepingFlow()` / `/housekeepingEvents` |
| `createdAt` | Timestamp | `FieldValue.serverTimestamp()` |

### 2. `charter_audit_log/charter-{charter_number}/events/{eventId}`
- Powers the live Operations Dashboard (`public/`).
- `startedAt`, `completedAt` (`null` while in-progress; stamped by `updateAuditEvent()`), `success` (`true` \| `false` \| `null`), `action`, `charterNumber`, `yachtName`, `clientName`, `startDate`, `endDate`, `charterType`, `cancelled`.
- `stages`: nested objects for `delete`, `orchestrate`, `maint`, `hk` (`success`, `startedAtMs`, `durationMs`, `tasksCreated`, `subtasksCreated`, `error`, `errorSource`).
- Top-level failure telemetry: `errorSource` (`"ASANA"` \| `"VALIDATION"` \| `"ORCHESTRATOR"`), `errorCode` (`"ASANA_API_ERROR"`, `"ASANA_RATE_LIMITED"`, `"VALIDATION_ERROR"`, `"INTERNAL_SERVER_ERROR"`), `error` (prefixed `[ASANA ERROR]` when upstream Asana failed), `asanaError` (structured status/method/endpoint/summary/raw errors).

### 3. `operation_locks/charter-{charter_number}` & `pending_operations/charter-{charter_number}`
- Atomic transactional lock (`action`, `auditId`, `lockedAt`) and FIFO queue array (`MAX_QUEUE_DEPTH = 3`) drained on completion or `Catch` via `processQueuedOperation()`.

## Helper Reference
| Function | Used In | Notes |
|---|---|---|
| `saveProvisioningState`, `getProvisioningState`, `deleteProvisioningState` | Orchestrator / Cleaner / Endpoints | Primary read on `"powerautomate"`, fallback on `(default)` |
| `getPreviousCharter`, `getNextCharter` | Maint / HK Services & Cleaner | Queries all `C.getYachtNameVariants(yachtName)` for cross-alias chronological bridging |
| `createAuditEvent`, `updateAuditStage`, `updateAuditEvent` | `index.js` | `updateAuditStage` keeps event in-progress; `updateAuditEvent` stamps `completedAt` |
| `acquireOperationLock`, `releaseOperationLock`, `enqueueOperation`, `dequeueOperation`, `cancelOperation`, `clearPendingQueue` | `index.js` | Per-charter lock & queue lifecycle |
| `getYachtConfig`, `getCharterTemplate`, `getCrewMember`, `getStandardJobs`, `getHousekeepingList` | **Unused** | Legacy config collections (runtime config lives in `config/*.js`) |

## Indexes (`firestore.indexes.json`)
- Deployed via `firebase.json` (`"firestore": { "database": "powerautomate", "indexes": "firestore.indexes.json" }`).
- Includes `COLLECTION` and `COLLECTION_GROUP` ascending/descending fieldOverrides for `events.startedAt` (used to list recent audit events across all charters).
