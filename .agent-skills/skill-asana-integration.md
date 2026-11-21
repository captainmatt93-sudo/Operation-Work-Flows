# Asana API Wrapper Skill

## What This Is
`functions/lib/asana.js` is the only module that talks to Asana. It uses native `fetch` (Node 22) against `https://app.asana.com/api/1.0` with a Personal Access Token from `process.env.ASANA_PAT`.

## Critical Rules

1. **Always go through `lib/asana.js`.** Do not call `fetch` to Asana from services; the wrapper handles auth, concurrency throttling, retries, structured `AsanaApiError` formatting, and empty DELETE/204 bodies.
2. **Structured `[ASANA ERROR]` exceptions (`AsanaApiError` & `summarizeAsanaErrorBody`):**
   - Any non-OK Asana response (after retries) or exhausted `429` retry throws an `AsanaApiError` with message:
     `[ASANA ERROR] (<status> <METHOD> <path>) <summary>`
   - Properties attached to the thrown error: `isAsanaError: true`, `source: "ASANA"`, `errorCode` (`"ASANA_API_ERROR"` or `"ASANA_RATE_LIMITED"`), `asanaStatus`, `asanaMethod`, `asanaPath`, `asanaSummary`, `asanaRawErrors`.
   - `summarizeAsanaErrorBody()` condenses Asana's verbose enum option list dumps into `Invalid Asana enum option GID "<gid>" (disabled or not valid on custom field)` while keeping raw Asana error objects in `asanaRawErrors`.
   - Webhook handlers (`functions/index.js`) convert `AsanaApiError` into HTTP `502 ASANA Error` (`source: "ASANA"`, `error_type: "ASANA_ERROR"`, structured `asana_error`) and record it in `charter_audit_log`.
3. **Write concurrency & automatic retry (`asanaRequest()`):**
   - Write calls (`POST`, `PUT`, `PATCH`, `DELETE`) share a 12-slot concurrency semaphore (`WRITE_CONCURRENCY = 12`).
   - HTTP `429` automatically respects the `Retry-After` header; transient `5xx` errors (`502`/`503`/`504`) retry with linear backoff (`attempt * 1500ms`, up to `retries = 3`).
4. **`searchTasks(params)` strips `null` / `undefined` values** before building query params so optional filters do not leak literal `"null"`/`"undefined"` strings.
5. **Search API returns max 100 results by default and no pagination is implemented.** Large boards (Charter Info filtered only by yacht) may be truncated, affecting back-to-back detection.
6. **Asana search is eventually consistent.** Tasks created seconds ago may not appear in `searchTasks` yet. Do not rely on search to find something created earlier in the same run - keep the GID instead.
7. **Custom field values:** enum fields take the option GID string, number fields take numbers, date fields take `yyyy-MM-dd`. `null` clears a field; `undefined` keys are dropped by `JSON.stringify`.
8. **The PAT has workspace-wide power.** Never log it and never commit it.

## Function Reference
| Function | Endpoint | Notes |
|---|---|---|
| `createTask(data)` | `POST /tasks` | Returns `{ data: { gid, ... } }` - use `.data.gid` |
| `createSubtask(parentGid, data)` | `POST /tasks/{gid}/subtasks` | |
| `createSubtasksWithWorkers(parentGid, items, workers)` | `POST /tasks/{gid}/subtasks` | Worker pool for small maintenance job lists (~3-4 items) |
| `batchCreateSubtasks(parentGid, items)` | `POST /batch` | Batches 10 subtasks per `/batch` call with 500ms delay & 3 retries (181 HK items) |
| `batchCreateTasksInSections(taskDefs)` | `POST /batch` | Batches 10 section tasks per call with `memberships` |
| `updateTask(gid, data)` | `PUT /tasks/{gid}` | |
| `deleteTask(gid)` | `DELETE /tasks/{gid}` | May return `null` on `204` / empty body |
| `getTask(gid, optFields)` | `GET /tasks/{gid}` | Returns `{ data }` |
| `duplicateProject(templateGid, name)` | `POST /projects/{gid}/duplicate` | Asana allocates `job.new_project.gid` immediately; orchestrator polls sections asynchronously |
| `getProject`, `deleteProject`, `updateProject` | `/projects/{gid}` | `updateProject` enforces model `CHECKOUT_COLORS` |
| `addProjectMember(projectGid, memberGid)` | `POST /projects/{gid}/addMembers` | Wrapped in `.catch()` by callers |
| `getProjectSections(projectGid)` | `GET /projects/{gid}/sections` | Returns array in board order |
| `getSectionTasks(sectionGid, optFields)` | `GET /sections/{gid}/tasks` | Returns first page (`data` array) |
| `addTaskToSection(sectionGid, taskGid)` | `POST /sections/{gid}/addTask` | Moves task within that project |
| `addCustomFieldToProject`, `ensureProjectCustomFields` | `POST /projects/{gid}/addCustomFieldSetting` | `ensure...` ignores "already" errors, warns on others |
| `searchTasks(params)` | `GET /workspaces/{ws}/tasks/search` | Strips `null`/`undefined`; returns `result.data` |
| `addTaskToProject(taskGid, projectGid)` | `POST /tasks/{gid}/addProject` | Multi-homes a task |
| `removeTaskFromProject(taskGid, projectGid)` | `POST /tasks/{gid}/removeProject` | Used when clearing/unlinking borrowed `Pre` section tasks |
| `AsanaApiError`, `summarizeAsanaErrorBody` | *(error class & helper)* | Thrown by `asanaRequest()` with `[ASANA ERROR]` prefix + enum dump summary |

## Return Shape Cheat Sheet
- `createTask`, `updateTask`, `getTask` -> `{ data: {...} }` (use `.data.gid`)
- `getProjectSections`, `getSectionTasks`, `searchTasks` -> plain array
- `duplicateProject` -> project object (use `.gid`; callers also check `.new_project?.gid`)

## Common Search Param Patterns
```javascript
// by project + exact text
{ "projects.any": C.BOARDS.CHARTER_INFO, "text": `"${charterName}"` }

// by custom field value (enum GID or text)
{ [`custom_fields.${C.CUSTOM_FIELDS.CHARTER_NUMBER}.value`]: charterNumber, "completed": false }

// by date window
{ "due_on.after": "2027-01-01", "due_on.before": "2027-02-01", "opt_fields": "name,due_on" }
```
Always request only the `opt_fields` you need when reading dates/names from results - default search results only include `gid`, `name`, `resource_type`.

## Rate Limiting
- Keep all loops sequential (`for ... of` + `await`).
- Subtask loops use a 150 ms delay. Add similar delays to any new loop that creates more than ~20 items.
- If you add retry logic, put it in `asanaRequest()` (honor the `Retry-After` header on 429) so every caller benefits.
