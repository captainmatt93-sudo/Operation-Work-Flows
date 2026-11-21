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
| `ASANA_WORKSPACE` | 5 | - | `asana.searchTasks`, `getWorkspaceUsers` |
| `CHECKOUT_TEAM` | 6 | - | `charterCleaner` legacy search |
| `EDITOR_MEMBER` | 7 | - | Reference GID (`charterOrchestrator` uses `TEST_MEMBER_GID`) |
| `BOARDS` | 10-22 | board key | Create Groups A/B/C; Maint/HK services; Delete steps |
| `START_DAY_GIDS`, `END_DAY_GIDS` | 25-44 | weekday name | `normalizePayload()` & Create Group A tracking task |
| `YACHT_ALIASES` | 47-72 | external/casing variant | `resolveYachtName()`, `getYachtNameVariants()` |
| `YACHT_NAME_GIDS` | 75-118 | yacht name / alias | Canonical `Yacht Name` (`1200083904458589`) enum GID — takes precedence over caller `yacht_name_id` |
| `resolveYachtName()`, `getYachtNameVariants()` | 125-153 | string | Resolves aliases case-insensitively and expands Firestore query variants |
| `HK_STAGE_SECTIONS`, `HK_YACHT_SECTIONS` | 157-206 | stage / yacht name | `housekeepingService` stage & yacht schedule placement |
| `CUSTOM_FIELDS` | 210-284 | field key | Everywhere |
| `CHARTER_TEMPLATES` | 287-293 | `charter_type` string | Create Group A (unknown -> throws) |
| `CHARTER_TYPE_IDS`, `SALES_AGENT_IDS`, `BOARDING_TIME_IDS`, `YACHT_MODEL_IDS` | 296-356 | display string | `normalizePayload()` & `orchestrateNewCharter()` enum resolution |
| `CHECKOUT_TEMPLATES` | 359-367 | yacht model | Create Group A (fallback `default`) |
| `CHECKOUT_COLORS` | 370-379 | yacht model | Enforced in Group B (`VOYAGE 590`/`590e` -> `"light-teal"` Turquoise; `VOYAGE 510`/`510e` -> `"dark-red"` Red; `480`/`480e` -> `"light-pink"`; `520` -> `"light-purple"`; `580` -> `"light-yellow"`) |
| `MAINTENANCE_PROJECTS` | 382-421 | yacht name | **Legacy map** — live maintenance service reads `M.YACHT_MAINTENANCE[yacht].project` in `config/maintenance.js` |
| `DAY_SECTIONS` | 424-432 | day name | IN/OUT placement (`createInOutSchedule`) |
| `CAPTAINS`, `CHEFS`, `BROKERS` | 435-467 | full name | `orchestrateNewCharter()` Steps 1-2 |
| `SALES_AGENTS`, `YACHT_MODELS` | 470-495 | name | `normalizePayload()` |
| `BOAT_TO_MODEL` | 498-541 | yacht name / alias | Auto-resolves model from yacht name (`normalizePayload()`, `orchestrateNewCharter()`, `housekeepingService`) |
| `YACHT_ACRONYMS` | 544-587 | yacht name / alias | Schedule & HK task prefixes |
| `MAINT_CREW` | 590-593 | crew key | `DAVID_ST_CLAIR` (`732999672531073`), `SHERLOCK_HARTMAN` (`130812572926108`) |
| `FIXED_MAINT_TASKS_DUAL` (7), `FIXED_MAINT_TASKS_SINGLE` (6) | 597-615 | array | Dual-genset (7 fixed + 1 Standard Jobs = 8 CO maint tasks) vs. Single-genset (6 fixed + 1 Standard Jobs = 7 CO maint tasks) |
| `SINGLE_GENSET_MODELS`, `SINGLE_GENSET_BOATS`, `isSingleGenset()`, `getFixedMaintTasks()` | 618-638 | Set / helper | Determines single vs. dual genset maintenance list |

## Charter Types (must match `data.charter_type` exactly)
`"Yacht & Captain"`, `"All Inclusive Crewed"`, `"Bareboat"`, `"Owner"`, `"Yacht & Crew"`.
Note: `"Yacht & Captain"` and `"Yacht & Crew"` share template GID `1203627293433267` (different colors). Confirm this is intentional before changing.

## Known Data Collisions (verify before relying on these)
| Issue | Detail |
|---|---|
| `YACHT_MODEL` == `SALESFORCE_ID` | Both `"1200070937070496"`. Housekeeping writes `yacht_model_id` into what may be the Salesforce ID field. |
| `CHEFS["Nia Mora"]` == `CAPTAINS["Tony Cook"]` | Both `"1201527061283020"`. One is likely a copy-paste error. |
| Asana Color Read vs Write Names | `GET /projects/{gid}` returns `"blue-green"` / `"red"`, while `PUT /projects/{gid}` requires write enums `"light-teal"` / `"dark-red"`. |

## Canonical Yacht Name Enum Precedence
`YACHT_NAME_GIDS` (`CUSTOM_FIELDS.YACHT_NAME = "1200083904458589"`) is stored in `config/constants.js` and **always takes precedence** over caller-supplied `yacht_name_id` in `normalizePayload()`, `orchestrateNewCharter()`, `maintenanceService.js`, and `housekeepingService.js`. This prevents disabled/archived enum GIDs sent by upstream CRM flows from triggering Asana 400 failures.

## Recent Fleet Vessels Reference (`Sea Cat-Alyst`, `It's About Time`, `Liv The Dream`)
| Vessel (Model / Genset / Acronym / HK Hours) | Aliases | `Yacht Name` Enum GID | Maint Project GID | HK Project GID | Yacht Schedule Sec | Cleaning Schedule Sec |
|---|---|---|---|---|---|---|
| **Sea Cat-Alyst** (`VOYAGE 590`, Dual, `SA`, `8/4/4`) | `"Sea Cat"`, `"Sea Cat-alyst"` | `1201359827957387` | `1220095351919692` | `1220098565321037` | `1220096000210714` | `1220099177143429` |
| **It's About Time** (`VOYAGE 590` #18, Single, `AT`, `8/4/4`) | `"It's about time"`, `"About Time"`, `"VOYAGE 590 #18"` | `1220098570898529` | `1220096004337545` | `1220096004337550` | `1220095361557816` | `1220098570898530` |
| **Liv The Dream** (`VOYAGE 510` #4, Single, `LD`, `5/2.5/2.5`) | `"Liv the Dream"`, `"510-04"`, `"510 #4"`, `"510 4"` | `1220162071658689` | `1220162118866804` | `1220162071804525` | `1220162118899048` | `1220162244965121` |

## Useful GIDs Quick Reference
| Thing | GID |
|---|---|
| Southern Cross `yacht_name_id` (from `test_payload.json`) | `1210332748843385` |
| All Inclusive Crewed `charter_type_id` | `1200083909658839` |
| Boarding time 12:00 PM / 05:00 PM | `1200113358975918` / `1200113358976962` |
| Charter Info board | `1200083712849552` |
| IN/OUT Schedule board | `1201610202732732` |

## Adding / Changing a Mapping
1. Find and verify the live enabled GID in Asana (`GET /custom_fields/{gid}` for enum options).
2. Add the vessel across `constants.js` (`YACHT_ALIASES`, `YACHT_NAME_GIDS`, `HK_YACHT_SECTIONS`, `BOAT_TO_MODEL`, `YACHT_ACRONYMS`, `SINGLE_GENSET_BOATS` if single genset) and `maintenance.js` (`YACHT_MAINTENANCE`, `YACHT_STAGES`, `YACHT_HK_PROJECTS`).
3. Keep spelling identical across all maps (add lowercase/punctuation aliases where Power Automate may vary).
4. Validate module load (`node`) and run the Testing Workflow end-to-end before deploying.
