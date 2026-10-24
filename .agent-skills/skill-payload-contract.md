# Payload Contract & normalizePayload() Skill

## What This Is
The single HTTP endpoint `charterEvents` (`functions/index.js` L107-171) receives charter events from the Power Automate / HubSpot flow. `normalizePayload()` (L53-92) converts the raw payload into the internal shape used by both services.

## Endpoint Contract
```
POST https://<region>-paynow-3f9dc.cloudfunctions.net/charterEvents   (Gen2 also exposes a run.app URL)
Headers:  Content-Type: application/json
          x-api-key: <WEBHOOK_API_KEY>
Body:     { "data": { "section": "Create" | "Delete" | "Edit", ...fields } }
```
| Response | When |
|---|---|
| `405` | Not POST |
| `401` | `x-api-key` missing/wrong, **or** `WEBHOOK_API_KEY` env var not set on the function |
| `400` | No `data`, unknown `section`, or Create date validation failed |
| `200 { Status, charterProjectGid, checkoutProjectGid }` | Create succeeded |
| `200 { Status, success }` | Delete / Edit finished (may include swallowed warnings) |
| `500 { error }` | Any thrown error (e.g. unknown `charter_type`, Asana failure) |

Function options: region `us-east4`, `timeoutSeconds: 540`, `memory: 512MiB`. A full Create typically makes 250+ Asana calls; keep the timeout high.

## Critical Rules

1. **`section` defaults to `"Create"`** when missing (L85). A Delete payload that forgets `section` will create a charter.
2. **Captain/Chef empty value is the literal string `'""'`** (two double-quote characters). It is normalized to `null`. Any falsy value also becomes `null`.
3. **`start_day` / `end_day` arrive as Asana enum GIDs**, not day names. They are copied to `start_day_id` / `end_day_id` for custom fields, and mapped to names via `DAY_GID_TO_NAME` for IN/OUT section placement. That map is unreliable - see [Known Issues](skill-known-issues.md).
4. **`boarding_time` may be an object `{ display, gid }` or a string.** Normalized to `boarding_time_display` and `boarding_time_gid`, but the original `boarding_time` is kept. Use the normalized fields in new code.
5. **Required for Create:** `charter_number`, `start_date`, `end_date`, `yacht_name`, `yacht_name_id`, `charter_type` (must be a `CHARTER_TEMPLATES` key), `charter_type_id`, `client_name` or `contact_name`.
6. **Required for Delete/Edit:** `charter_number`. Add `charter_name` too so the legacy fallback can work.
7. Dates are `yyyy-MM-dd` strings. `getDayName()` uses UTC, which is correct for date-only strings.

## Field Normalization Table
| Raw field | Normalized field(s) | Rule |
|---|---|---|
| `captain`, `chef` | same | `'""'` / falsy -> `null` |
| `start_day` | `start_day_id`, `start_day_name` | id = raw GID; name = `DAY_GID_TO_NAME[id]` or `getDayName(start_date)` |
| `end_day` | `end_day_id`, `end_day_name` | same pattern |
| `boarding_time` | `boarding_time_display`, `boarding_time_gid` | object or string |
| `number_of_guests` | `number_guests` | services read `number_guests` |
| `contact_name` / `client_name` | both | each falls back to the other; `client_name` = short name, `contact_name` = full name |
| `section` | `section` | default `"Create"` |
| `charter_name` | `charter_name` | default `"{yacht} | {client} | {start} | {end}"` |

## Charter Name Format Is Load-Bearing
`"Yacht | Client | Start | End"` is parsed back by `detectBackToBack()` and `createHousekeepingChecklists()` (`split(" | ")[1]` = client), used as the exact-text search key for board updates (Create Step 8), and embedded in the legacy delete search. Do not change the separator or order.

## Fields Read by Services but Not in the Sample Payload
`contact_email`, `charter_price`, `contact_id` (bridging task), `yacht_model_id` (HK Yacht Model field), `broker_name` (date validation email). Missing values become `null`/`""` - safe, but the Asana field will be blank.

## Sample Payload
See `test_payload.json` at the repo root. When copying it for tests, change `charter_number` to a `TEST-` value and use far-future dates (see [Testing Workflow](skill-testing-workflow.md)).
