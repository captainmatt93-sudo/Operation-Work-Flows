# Constants & GID Reference Skill

## What This Is
`functions/config/constants.js` holds every Asana GID and name mapping extracted from the legacy Power Automate flows. All services import it as `C`. `functions/config/maintenance.js` (imported as `M`) holds per-yacht maintenance/housekeeping config - see [Maintenance & Housekeeping](skill-maintenance-housekeeping.md).

## Critical Rules

1. **GIDs are strings.** Always quote them. Large GIDs exceed JS safe-integer precision if written as numbers.
2. **Custom field GID vs enum option GID.** `CUSTOM_FIELDS` mixes both: e.g. `PRIORITY` is the field, `PRIORITY_HIGH` is an option of that field. Use the field GID as the object key and the option GID as the value.
3. **Name-keyed maps require exact matches.** `CAPTAINS`, `CHEFS`, `BROKERS`, `CHARTER_TEMPLATES`, `CHECKOUT_TEMPLATES`, `YACHT_ACRONYMS` are keyed by display names from the booking system. A typo silently returns `undefined` (crew -> `null`, template -> throws, acronym -> 3-letter fallback).
4. **Verify a GID in Asana before adding it.** Wrong GIDs fail at runtime with an Asana 400/404 mid-flow, leaving partial artifacts.
5. **Do not delete "unused" constants without checking the Express Portal / Power Automate side** - some exist for parity with legacy flows.

## Map Reference
| Constant | Lines | Keyed by | Used in |
|---|---|---|---|
| `ASANA_WORKSPACE` | 5 | - | `asana.searchTasks` |
| `CHECKOUT_TEAM` | 6 | - | `legacyDelete` search |
| `EDITOR_MEMBER` | 7 | - | `addProjectMember` (known stale, non-fatal) |
| `BOARDS` | 10-17 | board key | Create Steps 3, 8, 12, 14, 15; Delete Steps 3b-4 |
| `CUSTOM_FIELDS` | 20-79 | field key | everywhere |
| `CHARTER_TEMPLATES` | 82-88 | `charter_type` string | Create Step 4 (unknown -> throws) |
| `CHECKOUT_TEMPLATES` | 91-100 | yacht name | Create Step 9 (fallback `default`) |
| `MAINTENANCE_PROJECTS` | 103-132 | yacht name | **Unused.** Stale - GIDs don't match `maintenance.js` |
| `DAY_SECTIONS` | 135-143 | day name | IN/OUT placement (Step 14) |
| `CAPTAINS` | 146-156 | full name | Step 2 |
| `CHEFS` | 159-168 | full name | Step 2 |
| `BROKERS` | 171-177 | full name -> email | Step 1 failure response |
| `YACHT_ACRONYMS` | 180-227 | yacht name | HK task names |
| `YACHT_ALIASES` | 231-233 | external name -> internal | Create Step 3 |
| `MAINT_CREW` | 236-239 | crew key | **Unused** (GIDs duplicated inline in `FIXED_MAINT_TASKS`) |
| `FIXED_MAINT_TASKS` | 242-249 | array | Step 12 |
| `CUSTOM_FIELDS.SECTION_ACTION` | 34 | - | **Unused** |

## Charter Types (must match `data.charter_type` exactly)
`"Yacht & Captain"`, `"All Inclusive Crewed"`, `"Bareboat"`, `"Owner"`, `"Yacht & Crew"`.
Note: `"Yacht & Captain"` and `"Yacht & Crew"` share template GID `1203627293433267` (different colors). Confirm this is intentional before changing.

## Known Data Collisions (verify before relying on these)
| Issue | Detail |
|---|---|
| `YACHT_MODEL` == `SALESFORCE_ID` | Both `"1200070937070496"`. Housekeeping writes `yacht_model_id` into what may be the Salesforce ID field. |
| `CHEFS["Nia Mora"]` == `CAPTAINS["Tony Cook"]` | Both `"1201527061283020"`. One is likely a copy-paste error. |
| Yacht spelling drift | `MAINTENANCE_PROJECTS` uses `"Busy Bs"`; everywhere else uses `"Busy B's"`. |

## Useful GIDs Quick Reference
| Thing | GID |
|---|---|
| Southern Cross `yacht_name_id` (from `test_payload.json`) | `1210332748843385` |
| All Inclusive Crewed `charter_type_id` | `1200083909658839` |
| Boarding time 12:00 PM | `1200113358975918` |
| Charter Info board | `1200083712849552` |
| IN/OUT Schedule board | `1201610202732732` |

Yacht name enum GIDs (`yacht_name_id`) and charter type enum GIDs are **not** stored in this repo - they come from the payload. If you need them, read the enum options of custom fields `YACHT_NAME` (`1200083904458589`) and `CHARTER_TYPE` (`1200083909657799`) via the Asana API.

## Adding / Changing a Mapping
1. Find the GID in Asana (URL, or `GET /custom_fields/{gid}` for enum options).
2. Add it as a quoted string in the right map, aligned with neighbours.
3. Search the repo for the key name to ensure spelling matches every other map.
4. Run the Testing Workflow end-to-end before deploying.
