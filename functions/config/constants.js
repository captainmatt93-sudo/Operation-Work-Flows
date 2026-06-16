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
};

// --- Custom Field GIDs ---
const CUSTOM_FIELDS = {
  SALESFORCE_ID:       "1200070937070496",
  YACHT_NAME:          "1200083904458589",
  NUMBER_OF_GUESTS:    "1200083906862042",
  CHARTER_TYPE:        "1200083909657799",
  SALES_AGENT:         "1200083837525030",
  CLIENT_NAME:         "1200083994856843",
  BOARDING_TIME:       "1200113358975895",
  CHARTER_PRICE:       "1200299819499351",
  START_DATE:          "1201313312041986",
  END_DATE:            "1201313210546653",
  CHARTER_NUMBER:      "1201313242954961",
  SECTION_ACTION:      "1201352764323157",
  START_DAY:           "1201397001788498",
  CONTACT_EMAIL:       "1201397047055605",
  END_DAY:             "1201397057037367",
  IN_OUT_TYPE:         "1201535750381848",
  IN_OUT_DEPARTURE:    "1201535750381851",
  IN_OUT_ARRIVAL:      "1201535750381874",
  IN_OUT_ARRIVAL_ALT:  "1202447108537080",
  TURNAROUND_DAYS:     "1202169752478904",
  BOAT_TYPE:           "1200671165516772",
};

// --- Charter Project Templates (Flow 2) ---
const CHARTER_TEMPLATES = {
  "Yacht & Captain":       { gid: "1203627293433267", color: "dark-blue" },
  "All Inclusive Crewed":   { gid: "1203627293433274", color: "dark-purple" },
  "Bareboat":              { gid: "1200083712849489", color: "dark-pink" },
  "Owner":                 { gid: "1203627293433281", color: "yellow-green" },
  "Yacht & Crew":          { gid: "1203627293433267", color: "light-yellow" },
};

// --- Checkout Project Templates (Flow 3) ---
const CHECKOUT_TEMPLATES = {
  "Endless Summer": "1200147531859477",
  "Moonstruck":     "1200147531859477",
  "Destiny":        "1200240983171131",
  "Let It Go":      "1200240983171131",
  "Legacy":         "1200240987644912",
  "Libre":          "1200240987644912",
  "Bareboat":       "1200242931026551",
  "default":        "1210380647223348",
};

// --- Per-Yacht Maintenance Project GIDs (Flow 5) ---
const MAINTENANCE_PROJECTS = {
  "Endless Summer": "930228245617935",
  "Moonstruck":     "691587298515988",
  "Destiny":        "717709282577739",
  "Let It Go":      "732995064675562",
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
};

// --- Yacht Acronyms (Flow 3) ---
const YACHT_ACRONYMS = {
  "Endless Summer": "ES",
  "Moonstruck":     "MS",
  "Destiny":        "DES",
  "Let It Go":      "LIG",
  "Legacy":         "LEG",
  "Libre":          "LIB",
  "Osprey":         "OSP",
  "Busy Bs":        "BB",
  "Island Spirit":  "IS",
  "Wild Hearts":    "WH",
  "Silverlining":   "SL",
  "Flow Rider":     "FR",
  "Miss Isla":      "MI",
  "Kittyhawk":      "KH",
  "Gia Sena":       "GS",
  "Grace":          "GR",
  "Adventure Us":   "AU",
  "Wanderlust":     "WL",
  "Victoria":       "VIC",
  "Kokomo":         "KOK",
  "Far Niente":     "FN",
  "Relentless":     "REL",
  "Gratitude":      "GRAT",
  "Nauti Buoys":    "NB",
};

module.exports = {
  ASANA_WORKSPACE,
  CHECKOUT_TEAM,
  EDITOR_MEMBER,
  BOARDS,
  CUSTOM_FIELDS,
  CHARTER_TEMPLATES,
  CHECKOUT_TEMPLATES,
  MAINTENANCE_PROJECTS,
  DAY_SECTIONS,
  CAPTAINS,
  CHEFS,
  BROKERS,
  YACHT_ACRONYMS,
};
