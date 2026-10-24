# Asana API Wrapper Skill

## What This Is
`functions/lib/asana.js` is the only module that talks to Asana. It uses native `fetch` (Node 22) against `https://app.asana.com/api/1.0` with a Personal Access Token from `process.env.ASANA_PAT`.

## Critical Rules

1. **Always go through `lib/asana.js`.** Do not call `fetch` to Asana from services; the wrapper handles auth, error text, and empty DELETE bodies.
2. **Errors throw** with the message `Asana {METHOD} {path} failed ({status}): {body}`. Callers decide whether to catch. There is **no automatic retry or 429 backoff** - a rate-limit response aborts the flow.
3. **`searchTasks(params)` passes params straight to `URLSearchParams`.** It does NOT strip `null`/`undefined`; they become the strings `"null"` / `"undefined"`. Guard values before calling:
   ```javascript
   if (!data.yacht_name_id) { logger.warn("No yacht_name_id - skipping search"); return; }
   ```
4. **Search API returns max 100 results by default and no pagination is implemented.** Large boards (Charter Info filtered only by yacht) may be truncated, affecting back-to-back detection.
5. **Asana search is eventually consistent.** Tasks created seconds ago may not appear in `searchTasks` yet. Do not rely on search to find something created earlier in the same run - keep the GID instead.
6. **Custom field values:** enum fields take the option GID string, number fields take numbers, date fields take `yyyy-MM-dd`. `null` clears a field; `undefined` keys are dropped by `JSON.stringify`.
7. **The PAT has workspace-wide power.** Never log it and never commit it.

## Function Reference
| Function | Endpoint | Notes |
|---|---|---|
| `createTask(data)` | `POST /tasks` | Returns `{ data: { gid, ... } }` - use `.data.gid` |
| `createSubtask(parentGid, data)` | `POST /tasks/{gid}/subtasks` | |
| `updateTask(gid, data)` | `PUT /tasks/{gid}` | |
| `deleteTask(gid)` | `DELETE /tasks/{gid}` | May return `null` |
| `getTask(gid, optFields)` | `GET /tasks/{gid}` | Returns `{ data }` |
| `duplicateProject(templateGid, name)` | `POST /projects/{gid}/duplicate` + poll `GET /jobs/{gid}` | Polls every 2 s, max 60 tries (120 s). Returns `new_project` object (`.gid`). `color` param is accepted but unused - caller sets color via `updateProject`. |
| `getProject`, `deleteProject`, `updateProject` | `/projects/{gid}` | |
| `addProjectMember(projectGid, memberGid)` | `POST /projects/{gid}/addMembers` | `EDITOR_MEMBER` is known stale - callers wrap in try/catch |
| `getProjectSections(projectGid)` | `GET /projects/{gid}/sections` | Returns array in board order |
| `getSectionTasks(sectionGid, optFields)` | `GET /sections/{gid}/tasks` | **No pagination** - returns first page only |
| `addTaskToSection(sectionGid, taskGid)` | `POST /sections/{gid}/addTask` | Moves task within that project |
| `addCustomFieldToProject`, `ensureProjectCustomFields` | `POST /projects/{gid}/addCustomFieldSetting` | `ensure...` ignores "already" errors, warns on others |
| `searchTasks(params)` | `GET /workspaces/{ws}/tasks/search` | Returns array (`result.data`) |
| `addTaskToProject(taskGid, projectGid)` | `POST /tasks/{gid}/addProject` | Multi-homes a task |
| `removeTaskFromProject` | `POST /tasks/{gid}/removeProject` | Currently unused |
| `batchCreateTasks(array)` | sequential `createTask` + 200 ms delay | Currently unused |

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
