// ============================================================
// Asana & Board Constants — extracted from legacy Power Automate flows
// ============================================================

const ASANA_WORKSPACE = "120581107550765";
const CHECKOUT_TEAM = "123586618271946";
const EDITOR_MEMBER = "1200083712849362";

// --- Centralized Master Boards ---
const BOARDS = {
  CHARTER_INFO:    "1200083712849552",
  ARRIVALS:        "1200083712849615",
  DEPARTURES:      "1200083712849641",
  IN_OUT_SCHEDULE: "1201610202732732",
  LAUNDRY:         "1201534108078115",
  YACHT_SCHEDULE:  "1201533939042396",
  CHECKOUT_MASTER: "1200203037114469",
  CHECKOUT_MASTER_SECTION: "1200234987888190",
  MECHANICAL_PROJECT: "1203946319141003",
  HK_STAGE_PROJECT: "1200107251427520",
  HK_YACHT_SCHEDULE: "1201533938937583",
};

// --- Start Day enum GIDs (on START_DAY custom field) ---
const START_DAY_GIDS = {
  "Monday":    "1201397001791582",
  "Tuesday":   "1201397001794619",
  "Wednesday": "1201397001795662",
  "Thursday":  "1201397001796765",
  "Friday":    "1201397001797806",
  "Saturday":  "1201397001797961",
  "Sunday":    "1201397001803121",
};

// --- End Day enum GIDs (on END_DAY custom field) ---
const END_DAY_GIDS = {
  "Monday":    "1201397057038401",
  "Tuesday":   "1201397057039559",
  "Wednesday": "1201397057042657",
  "Thursday":  "1201397057046785",
  "Friday":    "1201397057046823",
  "Saturday":  "1201397057046851",
  "Sunday":    "1201397057046871",
};

// --- Yacht Name Aliases (external webhook / HubSpot names → canonical config key) ---
const YACHT_ALIASES = {
  "Miles Away":          "Miles Away II",
  "Let it Go":           "Let It Go",
  "Busy Bs":             "Busy B's",
  "Busy Bee's":          "Busy B's",
  "5 0'Clock Somewhere": "5 O'Clock Somewhere",
  "SeaGlass":            "Sea Glass",
  "MoonStruck":          "Moonstruck",
  "Out of Office":       "Out Of Office",
  "Sea Cat":             "Sea Cat-Alyst",
  "Sea Cat-alyst":       "Sea Cat-Alyst",
  "It's about time":     "It's About Time",
  "Its About Time":      "It's About Time",
  "Its about time":      "It's About Time",
  "About Time":          "It's About Time",
  "About time":          "It's About Time",
  "VOYAGE 590 #18":      "It's About Time",
  "VOYAGE 590 # 18":     "It's About Time",
  "590 #18":             "It's About Time",
};

// --- Yacht Name enum GIDs (on YACHT_NAME custom field) ---
const YACHT_NAME_GIDS = {
  "Moonstruck":          "1200083904460769",
  "After Glow":          "1200083904460773",
  "Let It Go":           "1200083904462828",
  "Let it Go":           "1200083904462828",
  "Endless Summer":      "1200083904462829",
  "Sail La Vie":         "1201397077447620",
  "Osprey":              "1200083904463924",
  "No Regrets":          "1200083904464951",
  "Secret Oasis":        "1200083904464957",
  "Summer Breez":        "1200083904464958",
  "Home Sweet Home":     "1200113204165221",
  "Sol Liv":             "1200147320573158",
  "Home Again":          "1201359827953250",
  "Job Site":            "1201359827957387",
  "Auto Pirate":         "1203238000583932",
  "5 O'Clock Somewhere": "1203867689803137",
  "5 0'Clock Somewhere": "1203867689803137",
  "Home Away":           "1205533252285251",
  "Busy B's":            "1205952043988690",
  "Busy Bs":             "1205952043988690",
  "Busy Bee's":          "1205952043988690",
  "Treasure Hunter":     "1206131289977023",
  "Sea Glass":           "1207483377505420",
  "SeaGlass":            "1207483377505420",
  "Big Kid Island":      "1207483377505421",
  "The Drake":           "1208400762671018",
  "Way Maker":           "1210332748843384",
  "Southern Cross":      "1210332748843385",
  "Miles Away II":       "1211811642616857",
  "Miles Away":          "1211811642616857",
  "Decent Effort":       "1211811642616858",
  "Sea Cat-Alyst":       "1220097481120528",
  "Sea Cat":             "1220097481120528",
  "It's About Time":     "1220098570898529",
  "It's about time":     "1220098570898529",
  "About Time":          "1220098570898529",
  "VOYAGE 590 #18":      "1220098570898529",
};

/**
 * Resolve any incoming yacht name (alias or casing variation) to its canonical config key.
 * Returns the original trimmed string if no alias or case-insensitive match is found.
 */
function resolveYachtName(rawName) {
  if (!rawName || typeof rawName !== "string") return rawName;
  const trimmed = rawName.trim();
  if (YACHT_ALIASES[trimmed]) return YACHT_ALIASES[trimmed];
  if (YACHT_NAME_GIDS[trimmed]) return trimmed;

  const lower = trimmed.toLowerCase();
  for (const [alias, canonical] of Object.entries(YACHT_ALIASES)) {
    if (alias.toLowerCase() === lower) return canonical;
  }
  for (const key of Object.keys(YACHT_NAME_GIDS)) {
    if (key.toLowerCase() === lower) return YACHT_ALIASES[key] || key;
  }
  return trimmed;
}

/**
 * Return all known name variants for a yacht (e.g. ["Miles Away II", "Miles Away"])
 * so Firestore queries on provisioning_state match regardless of which variant was saved.
 */
function getYachtNameVariants(rawName) {
  if (!rawName || typeof rawName !== "string") return [];
  const trimmed = rawName.trim();
  const canonical = resolveYachtName(trimmed);
  const variants = new Set([trimmed, canonical]);
  for (const [alias, target] of Object.entries(YACHT_ALIASES)) {
    if (target === canonical) variants.add(alias);
  }
  return Array.from(variants);
}

// --- HK Stage Sections (on HK_STAGE_PROJECT) ---
const HK_STAGE_SECTIONS = {
  A: "1200107251427523",
  B: "1200107251427526",
  C: "1200107251427529",
};

// --- HK Yacht Schedule Sections (on HK_YACHT_SCHEDULE — by yacht name) ---
const HK_YACHT_SECTIONS = {
  "After Glow":          "1201533939042388",
  "Moonstruck":          "1201533938937593",
  "Let It Go":           "1201533938937591",
  "Let it Go":           "1201533938937591",
  "Endless Summer":      "1201533938937594",
  "No Regrets":          "1201533938937600",
  "Secret Oasis":        "1201533938937603",
  "Sail La Vie":         "1201533938937599",
  "Summer Breez":        "1201533938937606",
  "Osprey":              "1201533938937602",
  "Home Sweet Home":     "1201533938937604",
  "Sol Liv":             "1201533938937605",
  "Home Again":          "1201576342214029",
  "Job Site":            "1202117159894708",
  "Auto Pirate":         "1203237651929869",
  "5 O'Clock Somewhere": "1203857164241995",
  "5 0'Clock Somewhere": "1203857164241995",
  "Home Away":           "1205521963054611",
  "Busy B's":            "1205944054535997",
  "Busy Bs":             "1205944054535997",
  "Busy Bee's":          "1205944054535997",
  "Treasure Hunter":     "1206122229777619",
  "Sea Glass":           "1207406628662226",
  "SeaGlass":            "1207406628662226",
  "Big Kid Island":      "1207472672951874",
  "The Drake":           "1208400596928935",
  "Southern Cross":      "1210329355167190",
  "Way Maker":           "1210329355167189",
  "Miles Away II":       "1211811760681495",
  "Miles Away":          "1211811760681495",
  "Decent Effort":       "1211811761922882",
  "Sea Cat-Alyst":       "1220099177143429",
  "Sea Cat":             "1220099177143429",
  "It's About Time":     "1220098570898530",
  "It's about time":     "1220098570898530",
  "About Time":          "1220098570898530",
  "VOYAGE 590 #18":      "1220098570898530",
};

// --- Custom Field GIDs ---
const CUSTOM_FIELDS = {
  // Charter-level fields
  SALESFORCE_ID:       "1200070937070496",
  YACHT_NAME:          "1200083904458589",
  NUMBER_OF_GUESTS:    "1200083906862042",
  CHARTER_TYPE:        "1200083909657799",
  SALES_AGENT:         "1200083837525030",
  CLIENT_NAME:         "1200083994856843",
  ACCOUNT_NAME:        "1201313236481759",
  BOARDING_TIME:       "1200113358975895",
  CHARTER_PRICE:       "1200299819499351",
  START_DATE:          "1201313312041986",
  END_DATE:            "1201313210546653",
  CHARTER_NUMBER:      "1201313242954961",
  SECTION_ACTION:      "1201352764323157",
  START_DAY:           "1201397001788498",
  CONTACT_EMAIL:       "1201397047055605",
  END_DAY:             "1201397057037367",
  CONTACT_PHONE:       "1201396992589529",
  NUMBER_OF_NIGHTS:    "1200084005855741",
  // IN/OUT fields
  IN_OUT_TYPE:         "1201535750381848",
  IN_OUT_DEPARTURE:    "1201535750381851",
  IN_OUT_ARRIVAL:      "1201535750381874",
  IN_OUT_ARRIVAL_ALT:  "1202447108537080",
  TURNAROUND_DAYS:     "1202169752478904",
  BOAT_TYPE:           "1200671165516772",
  // Housekeeping fields
  PRESCRIBED_TIME:     "1200070986746678",
  CLEANING_STAGE:      "1200070937070490",
  STAGE_A:             "1200070937070491",
  STAGE_B:             "1200070937070492",
  STAGE_C:             "1200070937070493",
  INT_EXT:             "1200107716004993",
  INT_EXT_INTERIOR:    "1200107716005068",
  INT_EXT_EXTERIOR:    "1200107716005075",
  YACHT_MODEL:         "1200070937070496",
  PAY:                 "1205743144092841",
  // Maintenance fields
  PRIORITY:            "1199963408496823",
  PRIORITY_HIGH:       "1199963408496824",
  DEPARTMENT:          "1199963408496826",
  DEPT_MECHANICAL:     "1199963408496827",
  DEPT_RIGGING:        "1199963408496828",
  DEPT_GENERAL:        "1199963408496830",
  MAINT_TYPE:          "1199963667571238",
  MAINT_PREVENTATIVE:  "1199963667571244",
  MAINT_HOURS:         "1200028344003991",
  MAINT_MINUTES:       "1200028344003993",
  TOTAL_TIME:          "1209265022897877",
  // Maintenance-specific fields (different GIDs on maint projects)
  MAINT_PRIORITY:        "1199962527187402",
  MAINT_PRIORITY_HIGH:   "1199962527187403",
  MAINT_DEPARTMENT:      "1199963408496825",
  // Crew detail fields
  CREW_TYPE:           "1208796958001761",
  CREW_TYPE_CAPTAIN:   "1208796958001764",
  CREW_TYPE_CHEF:      "1208796958001765",
  BUDGET:              "1203721490099067",
  COST:                "1200294217202901",
  DIFFERENCE:          "1208594903802258",
  CONTACT_ID:          "1201313097523184",
  ACCOUNT_ID:          "1201313142033565",
  // Schedule task fields (Check-In | Check-Out)
  SCHEDULE_TYPE:           "1201099825060511",
  SCHEDULE_TYPE_STANDARD:  "1201099825060518",
  SCHEDULE_TYPE_NOON:      "1201099825060525",
  SCHEDULE_TYPE_MORNING:   "1201099825060525",
  SCHEDULE_TYPE_SLEEP:     "1201099825060529",
  // Boat Type enum values
  BOAT_TYPE_VESSEL_PREP:   "1201051657173400",
  BOAT_TYPE_BRIEFING:      "1200671165516783",
  BOAT_TYPE_DEBRIEF:       "1200671165516794",
  BOAT_TYPE_SLEEP_ABOARD:  "1201062910947860",
};

// --- Charter Project Templates (Flow 2) ---
const CHARTER_TEMPLATES = {
  "Yacht & Captain":       { gid: "1203627293433267", color: "dark-blue" },
  "All Inclusive Crewed":   { gid: "1203627293433274", color: "dark-purple" },
  "Bareboat":              { gid: "1200083712849489", color: "dark-pink" },
  "Owner":                 { gid: "1203627293433281", color: "yellow-green" },
  "Yacht & Crew":          { gid: "1203627293433267", color: "light-yellow" },
};

// --- Charter Type name → Asana enum option GID (CUSTOM_FIELDS.CHARTER_TYPE) ---
const CHARTER_TYPE_IDS = {
  "All Inclusive Crewed":                           "1200083909658839",
  "Bareboat":                                       "1200083909657801",
  "Bareboat Crewed":                                "1200083909657805",
  "Yacht & Captain":                                "1200083909658831",
  "Yacht & Chef":                                   "1200083909658836",
  "Owner":                                          "1200111825796823",
  "Day Sail - Full Day":                            "1209078999268728",
  "Day Sail - Half Day":                            "1209078999268729",
  "STT Water Taxi - Pick up Round Trip":            "1209078999268730",
  "STT Water Taxi - Pick up One Way Trip":          "1209078999268731",
  "EIS Airport - Pick Up Round Trip":               "1209078999268732",
  "EIS Airport - Pick Up One Way Trip":             "1209078999268733",
  "JOIN IN - STT Water Taxi - Pick up Round Trip":  "1209079041151484",
  "JOIN IN - STT Water Taxi - Pick up One Way Trip":"1209079041151485",
  "JOIN IN - EIS Airport - Pick Up Round Trip":     "1209079041151486",
  "JOIN IN - EIS Airport - Pick Up One Way Trip":   "1209079041151487",
  "Day Trip - 8 Hours":                            "1209079041151488",
  "Half Day Trip - 4 Hours":                       "1209079041151489",
  "Night Trip - 3 hours":                          "1209079041151490",
  "Peter Island - Pick Trips":                     "1214026149456039",
};

// --- Sales Agent name → Asana enum option GID (CUSTOM_FIELDS.SALES_AGENT) ---
const SALES_AGENT_IDS = {
  "Shawn Caraker Paulus": "1200083837525031",
  "Danyielle Roth":       "1200083837525032",
  "Chris Beavis":         "1200083837525033",
  "Clare Goodall":        "1200083837525034",
  "Peter Jones":          "1200111861308727",
  "Sarah Jones":          "1201954600773869",
  "Jenna Post":           "1208456224894347",
  "David Schlup":         "1208456224894348",
  "Oscar Mendoza":        "1211837770393074",
};

// --- Boarding Time display → Asana enum option GID (CUSTOM_FIELDS.BOARDING_TIME) ---
// Valid Asana enum values (verified 2026-07-03): "12:00 PM", "05:00 PM"
const BOARDING_TIME_IDS = {
  // Canonical values (exact Asana enum names)
  "12:00 PM": "1200113358975918",
  "05:00 PM": "1200113358976962",
  // Common aliases
  "5:00 PM":  "1200113358976962",   // same as 05:00 PM
  "Noon":     "1200113358975918",   // same as 12:00 PM
};

// --- Yacht Model name → Asana enum option GID (CUSTOM_FIELDS.YACHT_MODEL) ---
const YACHT_MODEL_IDS = {
  "VOYAGE 480":      "1200070937070497",
  "VOYAGE 480e":     "1201396780154466",
  "VOYAGE 500":      "1200070937070498",
  "VOYAGE 510":      "1205550579609036",
  "VOYAGE 510e":     "1205550579609037",
  "VOYAGE 520":      "1200070937070499",
  "VOYAGE 580":      "1200070937070500",
  "VOYAGE 590e":     "1200070937070501",
  "VOYAGE 590":      "1201396780156555",
  "VOYAGE 650":      "1200070937070502",
  "FORTY KNOTS 380": "1210354137579975",
};

// --- Checkout Project Templates (by model) ---
const CHECKOUT_TEMPLATES = {
  "VOYAGE 480":  "1200147531859477",
  "VOYAGE 510":  "1210380647223348",
  "VOYAGE 520":  "1200240983171131",
  "VOYAGE 580":  "1200240987644912",
  "VOYAGE 590":  "1200242931026551",
  "VOYAGE 590e": "1200242931026551",
  "default":     "1210380647223348",
};

// --- Checkout Project Colors (Asana write enum by model) ---
const CHECKOUT_COLORS = {
  "VOYAGE 480":  "light-pink",    // maps to Asana "pink"
  "VOYAGE 480e": "light-pink",
  "VOYAGE 510":  "dark-red",      // maps to Asana "red"
  "VOYAGE 510e": "dark-red",
  "VOYAGE 520":  "light-purple",  // maps to Asana "indigo"
  "VOYAGE 580":  "light-yellow",  // maps to Asana "yellow"
  "VOYAGE 590":  "light-teal",    // maps to Asana "blue-green" (Turquoise)
  "VOYAGE 590e": "light-teal",
};

// --- Per-Yacht Maintenance Project GIDs (Flow 5) ---
const MAINTENANCE_PROJECTS = {
  "Endless Summer": "930228245617935",
  "Moonstruck":     "691587298515988",
  "Let It Go":      "732995064675562",
  "Let it Go":      "732995064675562",
  "Mahi Mahi":      "120612499680437",
  "Azulia":         "120612499680437",
  "Legacy":         "123856243164731",
  "Osprey":         "691495498921912",
  "Libre":          "1198206201710141",
  "Busy Bs":        "1199964646135475",
  "Bareboat":       "887295831365148",
  "Island Spirit":  "1201060966855795",
  "Wild Hearts":    "1110518043677775",
  "Silverlining":   "1201589713415165",
  "Flow Rider":     "1202117165700542",
  "Miss Isla":      "732995064675487",
  "Kittyhawk":      "1203226595626562",
  "Gia Sena":       "1203866751839439",
  "Grace":          "1205521963054572",
  "Adventure Us":   "1205948903684939",
  "Wanderlust":     "1206122229775528",
  "Victoria":       "1207406595667894",
  "Kokomo":         "1207473667277308",
  "Far Niente":     "1208391787698878",
  "Relentless":     "1210331621233575",
  "Relentless II":  "1210331621233578",
  "Gratitude":      "1210775057987624",
  "Nauti Buoys":    "1211811642616860",
  "Sea Cat-Alyst":  "1220095351919692",
  "Sea Cat":        "1220095351919692",
  "It's About Time":"1220096004337545",
  "About Time":     "1220096004337545",
  "VOYAGE 590 #18": "1220096004337545",
};

// --- IN/OUT Schedule Day-of-Week Sections (Flow 7) ---
const DAY_SECTIONS = {
  "Monday":    "1201610202732738",
  "Tuesday":   "1201610202732739",
  "Wednesday": "1201610202732740",
  "Thursday":  "1201610202732741",
  "Friday":    "1201610202732742",
  "Saturday":  "1201610202732743",
  "Sunday":    "1201610202732744",
};

// --- Captain Name → Asana GID (Flow 1) ---
const CAPTAINS = {
  "Blade Goodall":       "123644982093628",
  "Kraig Williams":      "1202029006556152",
  "James Smyly":         "1202006633581362",
  "Ryan Adler":          "1201401420685552",
  "Tate Hempel":         "1201611625130451",
  "Thomas Karanatsis":   "1201955548975768",
  "Timothy Holt":        "123644982093616",
  "Tony Cook":           "1201527061283020",
  "Matthew Nelson":      "143158124817167",
};

// --- Chef Name → Asana GID (Flow 1) ---
const CHEFS = {
  "Danica Nel":            "1202028970935342",
  "Danielle Van Niekerk":  "1202041950894571",
  "Claudia Fioravanti":    "1202045090616641",
  "Kenetha Ashton":        "1202028973061950",
  "Jenafer Botes":         "1202089932861899",
  "Nicoleta Pascale":      "1202090058640759",
  "Robyn Ellor":           "1202006633713020",
  "Nia Mora":              "1201527061283020",
};

// --- Broker Name → Email (Flow 1) ---
const BROKERS = {
  "Shawn Caraker Paulus":  "shawn@voyagecharters.com",
  "Clare Goodall":         "clare@voyagecharters.com",
  "Danyielle Roth":        "danyielle@voyagecharters.com",
  "Chris Beavis":          "chris@voyagecharters.com",
  "Sarah Jones":           "sarah@voyagecharters.com",
  "Jenna Post":            "jenna@voyagecharters.com",
};

// --- Sales Agent Name → Asana GID ---
const SALES_AGENTS = {
  "Shawn Caraker Paulus": "1200083837525031",
  "Danyielle Roth": "1200083837525032",
  "Chris Beavis": "1200083837525033",
  "Clare Goodall": "1200083837525034",
  "Peter Jones": "1200111861308727",
  "Sarah Jones": "1201954600773869",
  "Jenna Post": "1208456224894347",
  "David Schlup": "1208456224894348",
  "Oscar Mendoza": "1211837770393074"
};

// --- Yacht Model Name → Asana GID ---
const YACHT_MODELS = {
  "VOYAGE 480": "1200070937070497",
  "VOYAGE 480e": "1201396780154466",
  "VOYAGE 500": "1200070937070498",
  "VOYAGE 510": "1205550579609036",
  "VOYAGE 510e": "1205550579609037",
  "VOYAGE 520": "1200070937070499",
  "VOYAGE 580": "1200070937070500",
  "VOYAGE 590e": "1200070937070501",
  "VOYAGE 590": "1201396780156555",
  "VOYAGE 650": "1200070937070502",
  "FORTY KNOTS 380": "1210354137579975"
};

// --- Boat Name → Model Name (auto-resolve model from yacht name) ---
const BOAT_TO_MODEL = {
  "Endless Summer":      "VOYAGE 480",
  "Moonstruck":          "VOYAGE 480",
  "Let It Go":           "VOYAGE 480",
  "Let it Go":           "VOYAGE 480",
  "After Glow":          "VOYAGE 480",
  "Sail La Vie":         "VOYAGE 480",
  "Southern Cross":      "VOYAGE 510",
  "Way Maker":           "VOYAGE 510",
  "Osprey":              "VOYAGE 520",
  "No Regrets":          "VOYAGE 520",
  "Secret Oasis":        "VOYAGE 580",
  "Busy B's":            "VOYAGE 590",
  "Busy Bs":             "VOYAGE 590",
  "Busy Bee's":          "VOYAGE 590",
  "Home Sweet Home":     "VOYAGE 590",
  "Sol Liv":             "VOYAGE 590",
  "Home Again":          "VOYAGE 590",
  "Job Site":            "VOYAGE 590",
  "Auto Pirate":         "VOYAGE 590",
  "5 O'Clock Somewhere": "VOYAGE 590",
  "5 0'Clock Somewhere": "VOYAGE 590",
  "Home Away":           "VOYAGE 590",
  "Treasure Hunter":     "VOYAGE 590",
  "Sea Glass":           "VOYAGE 590",
  "SeaGlass":            "VOYAGE 590",
  "Big Kid Island":      "VOYAGE 590",
  "The Drake":           "VOYAGE 590",
  "Miles Away II":       "VOYAGE 590",
  "Miles Away":          "VOYAGE 590",
  "Decent Effort":       "VOYAGE 590",
  "Sea Cat-Alyst":       "VOYAGE 590",
  "Sea Cat":             "VOYAGE 590",
  "It's About Time":     "VOYAGE 590",
  "It's about time":     "VOYAGE 590",
  "About Time":          "VOYAGE 590",
  "VOYAGE 590 #18":      "VOYAGE 590",
  "Summer Breez":        "VOYAGE 590e",
};

// --- Yacht Acronyms (Flow 3) ---
const YACHT_ACRONYMS = {
  "Endless Summer":      "ES",
  "Moonstruck":          "MS",
  "Let It Go":           "LIG",
  "Let it Go":           "LIG",
  "Osprey":              "OSP",
  "Busy B's":            "BB",
  "Busy Bs":             "BB",
  "Busy Bee's":          "BB",
  "After Glow":          "AG",
  "Secret Oasis":        "SO",
  "Summer Breez":        "SB",
  "Home Sweet Home":     "HSH",
  "Sol Liv":             "SL",
  "Sail La Vie":         "SLV",
  "Home Again":          "HA",
  "Job Site":            "JS",
  "Auto Pirate":         "AP",
  "5 O'Clock Somewhere": "5 0'",
  "5 0'Clock Somewhere": "5 0'",
  "Home Away":           "HW",
  "Treasure Hunter":     "TH",
  "Sea Glass":           "SG",
  "SeaGlass":            "SG",
  "Big Kid Island":      "BKI",
  "The Drake":           "TD",
  "Southern Cross":      "SC",
  "Way Maker":           "WM",
  "Miles Away II":       "MA2",
  "Miles Away":          "MA2",
  "Decent Effort":       "DE",
  "No Regrets":          "NR",
  "Sea Cat-Alyst":       "SA",
  "Sea Cat":             "SA",
  "It's About Time":     "AT",
  "It's about time":     "AT",
  "About Time":          "AT",
  "VOYAGE 590 #18":      "AT",
};

// --- Maintenance Crew Assignments ---
const MAINT_CREW = {
  DAVID_ST_CLAIR:  "732999672531073",
  SHERLOCK_HARTMAN: "130812572926108",
};

// --- Fixed Maintenance Tasks (from real project) ---
// --- Fixed Maintenance Tasks: Dual Genset (7 tasks) ---
const FIXED_MAINT_TASKS_DUAL = [
  { name: "Service port genset",              assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1.5 },
  { name: "Service stb genset",               assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1.5 },
  { name: "Wash port and stb engine rooms",   assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1.5 },
  { name: "Clean Genset Engine strainers",     assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 0.5 },
  { name: "Port and stb engine checks",       assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1 },
  { name: "Systems check",                    assignee: null,                        dept: "1199963408496830", hours: 1 },
  { name: "Rigging check and lubrication",    assignee: MAINT_CREW.SHERLOCK_HARTMAN, dept: "1199963408496828", hours: 2 },
];

// --- Fixed Maintenance Tasks: Single Genset (6 tasks) ---
const FIXED_MAINT_TASKS_SINGLE = [
  { name: "Service genset",                   assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1.5 },
  { name: "Wash port and stb engine rooms",   assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1.5 },
  { name: "Clean genset strainer",             assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 0.5 },
  { name: "Check port and stb engines",       assignee: MAINT_CREW.DAVID_ST_CLAIR,   dept: "1199963408496827", hours: 1 },
  { name: "Systems check",                    assignee: null,                        dept: "1199963408496830", hours: 1 },
  { name: "Rigging check and lubrication",    assignee: MAINT_CREW.SHERLOCK_HARTMAN, dept: "1199963408496828", hours: 2 },
];

// --- Genset Type Resolution ---
const SINGLE_GENSET_MODELS = new Set([
  "VOYAGE 480", "VOYAGE 480e", "VOYAGE 510", "VOYAGE 510e", "VOYAGE 520",
]);
const SINGLE_GENSET_BOATS = new Set([
  "The Drake", "Miles Away II", "Miles Away", "Decent Effort",
  "It's About Time", "It's about time", "About Time", "VOYAGE 590 #18",
]);

function isSingleGenset(yachtName, modelName) {
  const resolved = resolveYachtName(yachtName);
  if (SINGLE_GENSET_BOATS.has(yachtName) || SINGLE_GENSET_BOATS.has(resolved)) return true;
  if (modelName && SINGLE_GENSET_MODELS.has(modelName)) return true;
  return false;
}

function getFixedMaintTasks(yachtName, modelName) {
  return isSingleGenset(yachtName, modelName)
    ? FIXED_MAINT_TASKS_SINGLE
    : FIXED_MAINT_TASKS_DUAL;
}

module.exports = {
  ASANA_WORKSPACE,
  CHECKOUT_TEAM,
  EDITOR_MEMBER,
  BOARDS,
  START_DAY_GIDS,
  END_DAY_GIDS,
  YACHT_ALIASES,
  YACHT_NAME_GIDS,
  resolveYachtName,
  getYachtNameVariants,
  CUSTOM_FIELDS,
  CHARTER_TEMPLATES,
  CHARTER_TYPE_IDS,
  SALES_AGENT_IDS,
  BOARDING_TIME_IDS,
  YACHT_MODEL_IDS,
  CHECKOUT_TEMPLATES,
  CHECKOUT_COLORS,
  MAINTENANCE_PROJECTS,
  DAY_SECTIONS,
  HK_STAGE_SECTIONS,
  HK_YACHT_SECTIONS,
  CAPTAINS,
  CHEFS,
  BROKERS,
  SALES_AGENTS,
  YACHT_MODELS,
  BOAT_TO_MODEL,
  YACHT_ACRONYMS,
  MAINT_CREW,
  FIXED_MAINT_TASKS_DUAL,
  FIXED_MAINT_TASKS_SINGLE,
  getFixedMaintTasks,
  isSingleGenset,
};
