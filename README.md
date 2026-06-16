# Charter Orchestration Engine

Unified charter workflow orchestrator that replaces 8 fragmented Power Automate flows with a single Firebase Cloud Function.

**Firebase Project:** VOYAGE Operations (`paynow-3f9dc`)  
**Runtime:** Node.js 22 / Firebase Cloud Functions v2

## What It Does

When a charter booking is created, edited, or deleted, this system:

1. Validates dates and resolves crew assignments
2. Duplicates the correct Asana project template based on charter type
3. Creates tracking tasks across centralized boards (Charter Info, Arrivals, Departures)
4. Provisions checkout/maintenance projects with yacht-specific task lists
5. Calculates turnaround times and manages the IN/OUT schedule board
6. Detects back-to-back charters and creates debrief cross-links
7. Stores state in Firestore for instant cleanup (no more "bridging task" hacks)

## Setup

1. Set environment variables:
   ```bash
   firebase functions:config:set asana.pat="YOUR_ASANA_PAT" webhook.apikey="YOUR_SECRET_KEY"
   ```

2. Install dependencies:
   ```bash
   cd functions && npm install
   ```

3. Run locally:
   ```bash
   npm run serve
   ```

4. Deploy:
   ```bash
   npm run deploy
   ```

## API

```
POST /charterEvents
Header: x-api-key: <your secret>
Body: { data: { section: "Create"|"Delete"|"Edit", ...charter fields... } }
```

## Project Structure

```
functions/
├── index.js                    # Cloud Function entry point
├── config/
│   └── constants.js            # All Asana GIDs, custom fields, mappings
├── lib/
│   ├── asana.js                # Asana REST API wrapper
│   └── firestore.js            # Firestore config & state helpers
└── services/
    ├── charterOrchestrator.js  # Create flow (15 steps)
    └── charterCleaner.js       # Delete/Edit flow (6 steps)
```
