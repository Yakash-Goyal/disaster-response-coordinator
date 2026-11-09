# Team learning guide

A guide for the three of us to understand, explain and defend every part of the project.
For each concept: what it is in plain words, why we used it, and where it is in our code.

---

## 1. Suggested order for reading the code

1. `server/src/domain.ts`: the vocabulary (roles, incident types, statuses)
2. `server/src/db/migrations/001_init.sql`: the tables
3. `server/src/app.ts` and `server/src/index.ts`: how the server starts and which URLs exist
4. `server/src/modules/reports/reports.service.ts`: the report pipeline (the heart of the backend)
5. `server/src/agents/triage/triageGraph.ts` → `ruleClassifier.ts` → `llmClassifier.ts` → `urgency.ts`
6. `server/src/agents/dispatch/dispatchAgent.ts` and `server/src/agents/routing/routingAgent.ts`
7. `server/src/modules/dispatch/dispatch.service.ts`: accept / override
8. `client/src/App.tsx` → `pages/DashboardPage.tsx` → `components/IncidentPanel.tsx` → `components/DispatchSection.tsx`
9. `client/src/hooks/useLiveData.ts`: how the screen stays live

---

## 2. Concepts in plain words

### Client and server
The **client** is the React app running in the browser. The **server** is our Node.js program. The client
never touches the database; it asks the server, and the server checks permissions and runs the logic.

### REST API
A set of URLs the server understands, each meaning one action:
`GET /api/incidents` = "give me the queue", `POST /api/dispatch/decisions/5/accept` = "accept decision 5".
Data travels as **JSON**. All endpoints are listed in [API.md](API.md).

### Express and middleware
Express is the Node.js library that maps URLs to our functions. **Middleware** are functions that run before
the route, like checkpoints: `requireAuth` (are you logged in?), `requireRole('commander')` (are you allowed?).
See `server/src/middleware/`.

### TypeScript
JavaScript plus **types**. If we write `incident.severty` by mistake, the editor shows the error before we
run anything. `npm run typecheck` checks the whole project.

### Validation with zod
We never trust input from the browser. A zod schema describes valid data (e.g. text at least 10 characters,
latitude between −90 and 90); `validate()` rejects anything else with a clear message.
Example: `manualReportSchema` in `reports.routes.ts`.

### Passwords and JWT login
- Passwords are stored as **bcrypt hashes**: a one-way scramble, so even we cannot read them.
- After login the server gives a **JWT** (JSON Web Token): a signed note saying "user 1, commander, valid
  for 12 h". The browser sends it with every request. Changing the token breaks the signature, so it cannot
  be faked. See `middleware/auth.ts`.

### WebSockets (Socket.IO)
Normal HTTP is "browser asks, server answers". A WebSocket is an **always-open line**, so the server can
send news on its own. When a report creates an incident, the server calls
`broadcast('incident:updated', incident)` and every commander's screen updates within about a second.
See `realtime/socket.ts` and `client/src/hooks/useLiveData.ts`.

### PostgreSQL
Our relational database: tables with rows, linked by foreign keys (e.g. `reports.incident_id` →
`incidents.id`). We write plain SQL so every query is visible and explainable.
**Transactions** (`withTransaction`) make several changes all-or-nothing. When dispatching, the unit, the
incident and the decision all change together or not at all.

### PostGIS (geospatial database)
An extension that teaches PostgreSQL about locations.
- `GEOGRAPHY(POINT, 4326)`: a GPS point; distances come out in metres.
- `ST_MakePoint(lng, lat)`: build a point (note the order: **longitude first**).
- `ST_DWithin(a, b, 500)`: true if a and b are within 500 m. Used for **deduplication**.
- `ORDER BY a <-> b`: sort by distance. Used for **nearest units** (a "KNN" = k-nearest-neighbours search).
- **GIST index**: like a book index but for space. Without it the database would measure the distance to
  every row (the "naive distance loop" the SRS forbids). With it, it only looks at nearby rows.

### OSRM (routing engine)
Open Source Routing Machine computes **real road routes and travel times** on OpenStreetMap roads. We call:
- the **table** service: travel time from 4 units to 1 incident in a single request
- the **route** service: the full path to draw on the map

If OSRM cannot be reached we fall back to straight-line distance × 1.4 at 25 km/h and label it "estimate".
See `agents/routing/routingAgent.ts`.

### Nominatim (geocoding)
Turns an address into coordinates ("Velachery" → 12.98, 80.22) and back. It is free but allows only
1 request per second, so our server spaces out and caches requests (`modules/geocode/geocode.routes.ts`).

### LLM and structured output
An LLM (Gemini) reads text and answers. Instead of free text, we ask for **structured output**: we give it a
zod schema and it must reply with exactly `{ type, severity, confidence, title, reason }`. This makes the AI
answer safe to use in code. See `agents/triage/llmClassifier.ts`.

### LangGraph (agent orchestration)
A library for building AI workflows as a **graph**:
- **State**: a shared object that every step reads and updates (`text`, `classification`, `needsReview`...)
- **Node**: one step (a function), e.g. `classify_with_ai`
- **Edge**: which step comes next
- **Conditional edge**: the next step is decided at run time ("did the AI succeed? if not, use the rules")

Our Triage Agent is a 3-node graph (`agents/triage/triageGraph.ts`). In the end-term phase the Supervisor
Agent will join Triage, Dispatch and Routing into one bigger graph.

### What makes something an "agent" here?
Each agent has a clear goal, uses **tools** to reach it, and **explains** its decision:

| Agent | Goal | Tools it uses |
|---|---|---|
| Triage | understand the report | Gemini LLM, keyword rules |
| Dispatch | choose the best unit | PostGIS KNN search, the Routing Agent |
| Routing | real travel time and path | OSRM |

None of them takes a critical action alone. A human approves (**human in the loop**).

### React basics we use
- **Component**: a function that returns screen markup, e.g. `IncidentList`.
- **State** (`useState`): data that, when changed, redraws the component.
- **Effect** (`useEffect`): code that runs after drawing, e.g. loading data or listening to the socket.
- **Context**: data shared by many components without passing it down by hand (logged-in user, socket).
- **React Router**: which page shows for which URL, plus `RequireRole` to protect pages.

### Leaflet
The map library. `MapContainer` is the map, `TileLayer` the OpenStreetMap background, `CircleMarker` the
incidents, `Marker` the units, `Polyline` the route.

---

## 3. Who explains what (SRS §8 team split)

| Member | Area | Main files |
|---|---|---|
| **A: Ingestion & Triage** | report form, social feed, triage agent, deduplication, urgency score, incident queue | `modules/reports/`, `modules/feeds/`, `agents/triage/`, `modules/incidents/`, `NewReportPage.tsx`, `IncidentList.tsx`, `ClassificationReview.tsx` |
| **B: Agents & Dispatch** | dispatch agent, routing agent, accept/override, audit log, resources | `agents/dispatch/`, `agents/routing/`, `modules/dispatch/`, `modules/audit/`, `modules/resources/`, `DispatchSection.tsx`, `ResourcesPage.tsx` |
| **C: Real-time & Frontend** | WebSockets, dashboard, map, login, layout, database setup | `realtime/socket.ts`, `useLiveData.ts`, `SocketContext.tsx`, `DashboardPage.tsx`, `MapView.tsx`, `auth/`, `db/` |

Everyone should be able to explain the two main flows in [ARCHITECTURE.md](ARCHITECTURE.md) §3 and §5.

---

## 4. Good official resources

| Topic | Where |
|---|---|
| JavaScript / web basics | MDN Web Docs: developer.mozilla.org |
| TypeScript | typescriptlang.org → Docs → Handbook |
| React | react.dev/learn |
| Express | expressjs.com → Guide |
| PostgreSQL | postgresql.org/docs → Tutorial |
| PostGIS | postgis.net → Documentation → "Introduction to PostGIS" workshop |
| Socket.IO | socket.io/docs/v4 |
| Leaflet | leafletjs.com → Tutorials |
| LangGraph (JavaScript) | LangChain documentation → LangGraph → JavaScript |
| OSRM API | project-osrm.org → Documentation → API |
| JWT | jwt.io → Introduction |
| zod | zod.dev |

---

## 5. Likely viva questions (with short answers)

**Q1. What problem does the project solve?**
In a disaster, reports pour in from many channels, many describing the same event. Coordinators must decide
quickly which incident is most urgent and which unit to send. We automate the sorting, duplicate detection
and unit matching, and keep the human in charge of every dispatch.

**Q2. Why not let the AI dispatch automatically?**
Wrong dispatches cost lives, and AI can be wrong. The SRS requires human override for critical actions. The
agent recommends with a reason; the commander accepts or overrides; both are logged.

**Q3. What happens if the AI is down or there is no API key?**
The LangGraph conditional edge routes to the keyword classifier. Its results are marked low-confidence and
"Needs checking", so the system never silently guesses.

**Q4. How do you detect duplicate reports?**
After classification we look for an active incident of the same type within 500 m (`ST_DWithin`) whose last
report was within 60 minutes. If found, the report is merged and the report count rises, which raises the
urgency score. Both limits are configurable in `.env`.

**Q5. How is urgency calculated?**
Severity × 15 + type points (max 15) + 2 per extra report (max 10), capped at 100. It is simple on purpose:
every number can be explained, and the explanation is shown to the commander.

**Q6. How does the Dispatch Agent choose a unit?**
Nearest suitable free units by PostGIS KNN → prefer those with the needed equipment → real road ETAs from
OSRM for the top 4 → score = ETA + penalties for missing equipment and load → plain-language explanation.

**Q7. Why use road ETA instead of distance?**
The SRS says nearest is not always best. A unit 2 km away across a river may take longer than one 4 km away
on a direct road. Our explanation even mentions when this happens.

**Q8. What is a GIST index and why does it matter?**
A spatial index. It lets PostGIS find nearby rows without measuring the distance to every row, so queries
stay fast as data grows. The SRS asks for proper geospatial indexing.

**Q9. How do updates reach other screens?**
After every change the server broadcasts a Socket.IO event to the "control-room" room. Each open dashboard
updates its lists. After a dropped connection the client reloads everything to catch up.

**Q10. What if two commanders click "Send" on the same unit at the same moment?**
The accept runs in a database transaction with `SELECT ... FOR UPDATE` row locks, so the second request
waits for the first to finish. If both answered the same recommendation, the second sees it is no longer
pending ("already answered"). If two different incidents wanted the same unit, the second sees the unit is
no longer available. Either way the unit is never double-booked.

**Q11. How is the system secured?**
bcrypt password hashes, JWT on every request and socket connection, role checks on the server, zod
validation, parameterised SQL against injection, security headers with helmet.

**Q12. Why PostgreSQL and not MongoDB?**
The SRS specifies PostgreSQL + PostGIS. Our data is strongly related (reports → incidents → decisions →
resources), and PostGIS gives precise geospatial functions and indexes.

**Q13. Why LangGraph?**
It models the workflow as an explicit graph with state, nodes and conditional edges, which is easy to draw,
test and extend. The end-term Supervisor Agent will be a bigger graph built the same way.

**Q14. What is structured output?**
We give the LLM a schema and it must answer in that exact shape, validated by zod. No fragile text parsing.

**Q15. Where is the audit trail?**
`audit_log` table. Every agent classification, merge, recommendation and every human accept, override,
correction and status change is stored with actor, time and a readable summary. Each incident's History
panel shows it.

**Q16. How would the system scale to a real city?**
See [IMPROVEMENT_SCOPE.md](IMPROVEMENT_SCOPE.md): self-hosted OSRM, a job queue for triage, a Redis adapter
for Socket.IO across several servers, read replicas and pagination.

**Q17. Is the data real?**
Locality coordinates come from OpenStreetMap. Units, people and social media posts are fictional demo data.

**Q18. What is left for end-term?**
Supervisor Agent (conflict resolution, escalation), full responder mobile view, vehicle movement simulation,
notifications, weather feed, image upload, urgency aging, merge/split, decision log page, analytics, tests and
deployment. See [TODO.md](../TODO.md).
