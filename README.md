# Disaster Response Resource Coordinator

A command-and-control web platform for disaster response teams. It collects incident reports from several
channels, uses AI agents to classify and prioritise them, and recommends which ambulance, rescue team or
supply truck to send, with real road travel times and a plain-language reason. A human commander approves or
overrides every dispatch decision, and every agent decision and human response is logged.

The demo scenario is a monsoon flood across **Chennai**.

> **New here and not technical?** Read the step-by-step [User Guide](docs/USER_GUIDE.md).
>
> **Project status:** mid-term build. See [TODO.md](TODO.md) for the full task list (50 tasks) and what is
> done. The end-term plan and improvement ideas are in [docs/IMPROVEMENT_SCOPE.md](docs/IMPROVEMENT_SCOPE.md).

---

## What works now (mid-term)

| Area | What you can do |
|---|---|
| **Login & roles** | Commander, Admin and Field Responder accounts; each role sees only its own screens (JWT auth). |
| **Report intake** | Log a phone call through a form (search an address or click the map), or start the **mock social media feed**, which replays 26 flood posts from across Chennai. |
| **Triage Agent** | Classifies every report (type, severity, confidence) with **Google Gemini** through a **LangGraph** graph. If no API key is set or the AI fails, it falls back to keyword rules. Uncertain results are marked **"Needs checking"**. |
| **Deduplication** | Reports of the same type within 500 m and 60 minutes are merged into one incident (PostGIS `ST_DWithin`). The report count raises priority. |
| **Incident queue** | Live list sorted by an explainable **priority score (0–100)**. |
| **Classification review** | The commander confirms or corrects uncertain classifications. |
| **Dispatch Agent** | Finds the nearest suitable free units (PostGIS KNN search), checks equipment and load, gets **real road ETAs from OSRM**, ranks them and explains the choice. |
| **Human in the loop** | Commander clicks **Send** (accept) or **Choose another unit** (override, with a reason). Nothing is dispatched automatically. |
| **Incident lifecycle** | Waiting → Unit on the way → On scene → Resolved. Units become free again on resolve. |
| **Live map** | Incidents (coloured by severity) and units (coloured by status) on OpenStreetMap, with the road route of the suggested unit. |
| **Resource panel & admin** | Unit status counts on the dashboard. Admins can add, edit, retire and restore resources. |
| **Audit trail** | Every agent decision and human action is stored with a timestamp and shown in each incident's History. |
| **Real-time** | All open screens update within about a second over WebSockets, with no refresh needed. |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, React Router, Leaflet + OpenStreetMap (react-leaflet) |
| Backend | Node.js + Express 5 + TypeScript |
| AI agents | LangGraph.js, Google Gemini (`@langchain/google-genai`) |
| Database | PostgreSQL 17 + PostGIS 3.6 |
| Real-time | WebSockets (Socket.IO) |
| Routing | OSRM (public server, configurable) |
| Geocoding | OpenStreetMap Nominatim |
| Auth | JWT + bcrypt, role-based access |
| Validation | zod |

---

## Folder structure

```
Minor Project/
├── TODO.md                     full task list with mid-term / end-term split
├── package.json                one-command scripts for the whole project
├── docs/
│   ├── USER_GUIDE.md           plain-language setup + how to use every screen (all 3 roles)
│   ├── ARCHITECTURE.md         how the system works (diagrams, flows, database)
│   ├── API.md                  every API endpoint
│   ├── LEARNING_GUIDE.md       what to learn, where it is in the code, viva questions
│   └── IMPROVEMENT_SCOPE.md    end-term plan and improvement ideas
├── server/                     backend (Express API + agents + WebSockets)
│   ├── .env.example            configuration template
│   └── src/
│       ├── index.ts            starts the HTTP + WebSocket server
│       ├── app.ts              Express app: middleware and routes
│       ├── domain.ts           allowed values (roles, types, statuses)
│       ├── config/env.ts       reads and validates .env
│       ├── db/                 connection pool, migration runner, SQL schema, seed data
│       ├── middleware/         auth (JWT + roles), validation, error handling
│       ├── agents/
│       │   ├── triage/         Triage Agent (LangGraph graph, AI + keyword classifiers, urgency score)
│       │   ├── dispatch/       Dispatch Agent (candidate search, ranking, rationale)
│       │   └── routing/        Routing Agent (OSRM client)
│       ├── modules/            one folder per feature: routes (HTTP) + service (logic + SQL)
│       │   ├── auth/  reports/  incidents/  resources/  dispatch/
│       │   └── feeds/ (mock social feed)  geocode/  audit/
│       ├── realtime/socket.ts  Socket.IO setup and broadcast helpers
│       ├── data/               Chennai localities and synthetic social posts
│       └── utils/              errors, logger, geo helpers
└── client/                     frontend (React)
    └── src/
        ├── App.tsx             screens and who can open them
        ├── api/                fetch wrapper + data types
        ├── auth/               login state, route guard
        ├── hooks/              live connection, live data, clock
        ├── pages/              Login, Dashboard, Log a report, Resources, Responder
        ├── components/         map, incident queue, incident panel, dispatch, forms...
        ├── lib/                labels, formatting, map styling
        └── styles/global.css   colours, buttons, forms, badges
```

---

## Running it on your computer (Windows)

### 1. Install the prerequisites (one time)

| Software | Version used | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) | 24 LTS | includes npm |
| [PostgreSQL](https://www.postgresql.org/download/windows/) | 17 | remember the password you set for the `postgres` user |
| [PostGIS](https://postgis.net/documentation/getting_started/install_windows/) | 3.6 for PostgreSQL 17 | install with Stack Builder (comes with PostgreSQL) or the OSGeo bundle |

On the original development machine PostgreSQL was installed with
`winget install PostgreSQL.PostgreSQL.17`, and PostGIS from the official bundle
`postgis-bundle-pg17-3.6.2x64.zip` (download.osgeo.org), copied into `C:\Program Files\PostgreSQL\17`.

### 2. Create the database

Open **SQL Shell (psql)** or pgAdmin and run:

```sql
CREATE DATABASE drrc;
```

(PostGIS is enabled automatically by the first migration.)

### 3. Configure the server

```bash
cd server
copy .env.example .env
```

Open `server/.env` and check:

- `DATABASE_URL`: change `postgres:postgres` to `postgres:<your password>` if your password is different
- `JWT_SECRET`: any long random string
- `GEMINI_API_KEY`: optional (see step 6)

### 4. Install packages and prepare the database

From the project root (`Minor Project/`):

```bash
npm run setup       # installs root, server and client packages
npm run db:reset    # creates the tables and loads the Chennai demo data
```

> `db:reset` deletes all data and reloads the demo data. Use it before every demo for a clean start.

### 5. Start the app

```bash
npm run dev
```

This starts both parts:

- API + live updates: <http://localhost:4000>
- Web app: **<http://localhost:5173>** (open this one)

### 6. Turn on the AI (optional, recommended)

Without a key the Triage Agent uses keyword rules and marks every incident for checking.
To use Gemini:

1. Create a free API key at <https://aistudio.google.com> (sign in with a Google account, choose **Get API key**).
2. Paste it into `server/.env`: `GEMINI_API_KEY=your-key-here`
3. Restart `npm run dev`. The server log will say `Triage Agent: AI mode (gemini-3.5-flash)`.

---

## Demo accounts

Created by the seed script (`server/src/db/seed.ts`). On the login page, click a name to fill them in.

| Role | Email | Password |
|---|---|---|
| Commander | commander@drrc.local | Commander@123 |
| Admin | admin@drrc.local | Admin@123 |
| Field responder (AMB-01) | responder1@drrc.local | Responder@123 |
| Field responder (FIRE-01) | responder2@drrc.local | Responder@123 |
| Field responder (BOAT-01) | responder3@drrc.local | Responder@123 |
| Field responder (TRK-01) | responder4@drrc.local | Responder@123 |

---

## Demo script for the evaluation (about 8 minutes)

1. Run `npm run db:reset`, then `npm run dev`. Open <http://localhost:5173>.
2. **Log in as Commander.** Show the map: units (A/T/S/H squares) and shelters across Chennai, the unit status panel on the right.
3. **Start the social media feed.** Every 5 seconds a post arrives. Show:
   - incidents appearing in the queue, sorted by priority score
   - the Velachery and Saidapet posts **merging** into one incident ("2 reports", then "3 reports"), with the score going up
   - the "Needs checking" tag on uncertain classifications
4. **Open the top incident.** Explain the **Priority** explanation and the **Classification** reason. Click **Yes, looks right** or correct it.
5. Click **Find the best unit.** Show the suggested unit, the **road route on the map**, the ETA, and the plain-language reason. Open **Other units considered**.
6. Click **Send**. The unit turns blue (on the way) on the map and in the panel, and the queue updates instantly.
7. On another incident, click **Choose another unit**, pick a different one, type a reason and send it (an **override**).
8. Click **Mark as arrived**, then **Mark as resolved**. The unit becomes available again.
9. Scroll to **History** to show the audit trail (agent decisions and human responses with times).
10. Go to **Log a report**, type a phone report, search "Velachery", save. Show the result (merged or new).
11. Log in as **Admin** in a second browser window and add or edit a resource. The commander's screen updates live.
12. Optionally, log in as a **Responder** on a phone-sized window to show the unit page (full responder view comes at end-term).

---

## Useful commands

| Command (from project root) | What it does |
|---|---|
| `npm run setup` | Install all packages |
| `npm run dev` | Start server and client together |
| `npm run db:reset` | Recreate tables and reload demo data |
| `npm run db:migrate` | Apply new database migrations only |
| `npm run ai:check` | Test that the Gemini API key in `server/.env` works |
| `npm run typecheck` | Check TypeScript types (server) and build the client |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to the database` | PostgreSQL service not running, or the password in `DATABASE_URL` is wrong. |
| `Migration 001_init.sql failed: ... postgis ...` | PostGIS is not installed for PostgreSQL 17. Install it (step 1) and run `npm run db:reset` again. |
| Port 4000 or 5173 already in use | Close the other program using it, or change `PORT` in `server/.env` (then also update the proxy in `client/vite.config.ts`). |
| ETAs say "(estimate)" | The public OSRM server could not be reached (no internet or it is busy). The app keeps working with straight-line estimates. |
| Address search says "not available" | Nominatim could not be reached. Click on the map to set the location instead. |
| Map is grey | No internet connection, so the OpenStreetMap tiles cannot load. |

---

## Credits

Map data © OpenStreetMap contributors. Routing by OSRM. Geocoding by Nominatim.
All social media posts, people and handles in the demo data are fictional.
