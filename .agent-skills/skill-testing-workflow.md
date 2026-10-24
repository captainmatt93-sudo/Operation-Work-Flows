# Testing Workflow Skill

## What This Is
There is no automated test suite (`firebase-functions-test` is installed but unused). All verification is done by sending real payloads and inspecting Asana + Firestore. Because Asana is production, testing must be disciplined.

## Critical Rules

1. **Always run the full cycle: Create -> inspect -> Delete -> inspect.** Never leave test artifacts in Asana.
2. **Use far-future dates** (e.g. 2027+) so test charters do not appear next to real ones and do not trigger back-to-back logic against real bookings.
3. **Use a `TEST-` charter number** (e.g. `TEST-SC-001`). Delete and board cleanup match on charter number.
4. **Inspect Asana before deleting.** The Delete step removes the evidence.
5. **Never put the API key in a committed file.** Read it from an environment variable in your shell.

## PowerShell Test Cycle
```powershell
# Set once per shell session (do not commit)
$env:WEBHOOK_API_KEY = "<paste key>"
$url = "http://127.0.0.1:5001/paynow-3f9dc/us-east4/charterEvents"   # or the deployed URL
$h   = @{ "Content-Type" = "application/json"; "x-api-key" = $env:WEBHOOK_API_KEY }

# 1. Create
$create = @{ data = @{
  section = "Create"; charter_number = "TEST-SC-001"
  charter_name = "Southern Cross | Test | 2027-03-05 | 2027-03-12"
  start_date = "2027-03-05"; end_date = "2027-03-12"
  yacht_name = "Southern Cross"; yacht_name_id = "1210332748843385"
  charter_type = "All Inclusive Crewed"; charter_type_id = "1200083909658839"
  client_name = "Test"; contact_name = "Test User"; contact_email = "test@example.com"
  number_of_guests = "4"; captain = '""'; chef = '""'; charter_price = 1000
  boarding_time = @{ display = "12:00 PM"; gid = "1200113358975918" }
}} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri $url -Method POST -Headers $h -Body $create

# 2. Inspect Asana + Firestore (see checklist below)

# 3. Delete
$del = @{ data = @{ section = "Delete"; charter_number = "TEST-SC-001"
  charter_name = "Southern Cross | Test | 2027-03-05 | 2027-03-12" } } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri $url -Method POST -Headers $h -Body $del
```
`ConvertTo-Json -Depth 5` is required - the default depth (2) flattens `boarding_time` into a string.

Note: the sample omits `start_day` / `end_day`, so day names fall back to `getDayName(date)` (reliable). Include them only when testing the GID mapping specifically.

## Post-Create Checklist
- [ ] Charter project `"Southern Cross | Test | ..."` exists with the All Inclusive Crewed template color.
- [ ] Checkout project `"Check-Out | Check-In, Southern Cross | Test | ..."` exists.
- [ ] Checkout section 7 (Post - Maintenance Info): 6 fixed tasks + `@Standard Jobs` with subtasks.
- [ ] Checkout section 6 (Post - House Keeping Info): 6 tasks `"SC | Test, Interior A"` ... `"Exterior C"`, each with subtasks and Pay set.
- [ ] Tracking task on Charter Info board.
- [ ] IN/OUT board: DEPARTURE and ARRIVAL both in the **Friday** section (2027-03-05 and 2027-03-12 are Fridays).
- [ ] Firestore doc `provisioning_state/charter-TEST-SC-001` exists with all GIDs.
- [ ] Cloud/emulator logs show `[Step 1]` ... `[Step 15]` and the final check line, with no unexpected warnings.

## Post-Delete Checklist
- [ ] Both projects gone.
- [ ] Tracking task and IN/OUT tasks gone.
- [ ] Firestore doc gone.
- [ ] Logs show `[Delete Step 1]` ... `[Delete Step 5]` and no warnings.

## Testing Edit
Edit = Delete + HubSpot callback. Sending `section: "Edit"` against the **deployed** function will POST to the real HubSpot service, which may re-create the charter. Test Edit only when you intend that round trip, and only with `TEST-` numbers.

## Testing Failure Paths (cheap, no Asana writes)
| Payload | Expected |
|---|---|
| No `x-api-key` | 401 |
| `GET` request | 405 |
| `{}` body | 400 Missing payload data |
| `section: "Foo"` | 400 Unknown action |
| `start_date` after `end_date` | 400 `Start date is after end date` (no Asana writes - Step 1 runs first) |

## Cleaning Up a Failed Run
If Create fails mid-way, run Delete with the same `charter_number` and `charter_name`. If Firestore state was never written (failure before Step 11), Delete uses legacy search, which needs the bridging task (Step 10). If that also fails, remove the projects manually in Asana and search boards for the test charter number.
