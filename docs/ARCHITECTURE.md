# Architecture

This document explains how the system is put together and how data flows through it.
Section numbers like "SRS 4.2" refer to the Software Requirements Specification.

---

## 1. Big picture

```
                         ┌──────────────────────────────────────────────┐
  Report sources         │                 BACKEND (Node + Express)      │
  ───────────────        │                                               │
  Manual form  ────┐     │  ┌──────────────┐     ┌───────────────────┐   │
  (phone calls)    │     │  │   Report     │     │   Triage Agent    │   │
                   ├────▶│  │  ingestion   │────▶│   (LangGraph)     │   │
  Mock social  ────┘     │  │  pipeline    │     │  Gemini or rules  │   │
  media feed             │  └──────┬───────┘     └───────────────────┘   │
                         │         │ dedup (PostGIS)                      │
                         │         ▼                                      │
                         │  ┌──────────────┐  ask   ┌─────────────────┐  │
                         │  │  Incident    │──────▶ │ Dispatch Agent  │  │
                         │  │  queue       │        │ (KNN + ranking) │  │
                         │  └──────────────┘        └───────┬─────────┘  │
                         │         ▲                        │ ETAs       │
                         │         │ accept / override      ▼            │
                         │         │                ┌─────────────────┐  │
                         │         │                │ Routing Agent   │──┼──▶ OSRM
                         │         │                └─────────────────┘  │
                         │  ┌──────┴──────┐   ┌───────────────────────┐  │
                         │  │ REST API    │   │ Socket.IO (live push) │  │
                         │  └──────┬──────┘   └──────────┬────────────┘  │
                         └─────────┼─────────────────────┼───────────────┘
                                   │                     │
                         ┌─────────▼─────────────────────▼───────────────┐
                         │          FRONTEND (React, in the browser)      │
                         │  Command dashboard · Log a report · Resources  │
                         │  Responder view                                │
                         └────────────────────────────────────────────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ PostgreSQL+PostGIS│  (all data, audit log)
                         └───────────────────┘
```

As the SRS (§3) requires, the frontend talks to the backend in two ways:

- **REST (HTTP + JSON)** to load data and perform actions, e.g. `POST /api/dispatch/decisions/5/accept`
- **WebSockets** (Socket.IO) for the server to **push** changes to every open screen, e.g. `incident:updated`

---

## 2. Backend layers

Every feature lives in `server/src/modules/<feature>/` and follows the same pattern:

```
HTTP request
   │
   ▼
<feature>.routes.ts   → checks the role, validates input (zod), calls the service
   │
   ▼
<feature>.service.ts  → business rules + SQL queries, writes the audit log,
   │                    broadcasts live updates
   ▼
PostgreSQL / PostGIS
```

The three agents live in `server/src/agents/` and are called by the services.

Cross-cutting pieces:

| File | Job |
|---|---|
| `config/env.ts` | Reads `.env` once and validates it; the server refuses to start with bad config |
| `middleware/auth.ts` | Verifies the JWT on every request, `requireRole(...)` blocks the wrong roles |
| `middleware/validate.ts` | Checks request data against a zod schema and returns a clear 400 message |
| `middleware/errorHandler.ts` | Turns any thrown error into a JSON response; unknown errors become a safe 500 |
| `db/pool.ts` | One shared connection pool; `withTransaction()` for all-or-nothing changes |
| `realtime/socket.ts` | Socket.IO with JWT check on connect; `broadcast()` to the control room |

---

## 3. Flow 1: a report arrives (SRS 4.1, 4.2, 4.3)

File: `server/src/modules/reports/reports.service.ts` → `ingestReport()`

```
1. Save the raw report           INSERT INTO reports ...           (nothing is lost if later steps fail)
2. Triage Agent                  runTriage(text)                   → type, severity, confidence, reason
3. Audit log                     "Classified report #12 as Flooding, severity 4, 85% confident..."
4. Deduplication (one at a time) find an active incident:
                                   - same type
                                   - within DEDUP_RADIUS_METERS (500 m)     ST_DWithin(location, point, 500)
                                   - last report within 60 minutes
                                   - nearest first                          ORDER BY location <-> point
   ├─ found     → merge: report_count + 1, keep the highest severity, recompute urgency
   └─ not found → create a new incident
5. Audit log                     "Report #13 describes the same event as incident #4 (95 m away)..."
6. Live push                     broadcast('incident:updated', incident)
```

**Why "one at a time"?** Triage (the slow AI call) runs in parallel, but step 4 runs through a small queue.
Otherwise two reports about the same flood arriving together could both miss each other and create two
incidents.

**Why is type "other" never merged?** Two vague reports close together are not necessarily the same event.

### Urgency score (SRS 4.2)

File: `server/src/agents/triage/urgency.ts`

```
score = severity × 15            (max 75)
      + incident-type points      (collapse/fire 15, medical 12, flood 10, supply 6, road/power 5, other 3)
      + 2 × extra reports         (max 10)
```

The score always comes with a sentence explaining it (shown on the dashboard), e.g.
*"Severity 5 gives 75 pts, incident type gives 10 pts, 2 confirming reports add 4 pts."*

---

## 4. The Triage Agent as a LangGraph graph

File: `server/src/agents/triage/triageGraph.ts`

```
          START
            │
   [classify_with_ai] ──── AI failed / no key ────▶ [classify_with_rules]
            │                                               │
            └─────────────▶ [check_confidence] ◀────────────┘
                                    │
                                   END
```

- **State**: `{ text, classification, method, aiError, needsReview }`, shared by all nodes.
- **classify_with_ai** (`llmClassifier.ts`): Gemini with `withStructuredOutput(zodSchema)`, so the answer
  always has exactly the fields `type, severity, confidence, title, reason`. Temperature 0 (same input, same
  answer), 15-second timeout, 1 retry.
- **classify_with_rules** (`ruleClassifier.ts`): keyword matching. Confidence is capped at 0.5.
- **check_confidence**: `needsReview = (method is rules) OR (confidence < TRIAGE_REVIEW_THRESHOLD)`.
  This is how the SRS rule "flag low-confidence classifications for human review rather than silently
  guessing" is met.

---

## 5. Flow 2: dispatching a unit (SRS 4.5, 4.6, 5)

### Step A: the Dispatch Agent recommends

File: `server/src/agents/dispatch/dispatchAgent.ts` → `recommendUnits()`

```
1. What is needed?           requirements.ts: e.g. flood → response team with "water_rescue"
                                              medical severity ≥ 4 → ambulance with "advanced_life_support"
2. Nearest free units        SELECT ... FROM resources
   (PostGIS KNN)              WHERE type = ANY(...) AND status = 'available' AND current_load < capacity
                              ORDER BY location <-> ST_MakePoint(lng, lat)::geography   -- uses GIST index
                              LIMIT 8
3. Capability check          units that carry everything first, then by distance → shortlist of 4
4. Real road ETAs            Routing Agent → one OSRM "table" request for all 4 units
5. Score (lower is better)   ETA minutes + 10 per missing capability + 3 × load ratio
6. Explain                   "BOAT-02 recommended: 9 min by road (6.5 km), 2 min faster than BOAT-03.
                              Carries water rescue boat."
```

The result is stored as a **pending** row in `dispatch_decisions` together with all candidates (JSON).
Nothing changes for the unit yet.

**Why not just pick the nearest?** The SRS says "rather than assuming nearest = best". The straight-line
nearest unit may be across a river. Step 4 uses the real road network, and the explanation even says when a
unit "looks nearer on the map but takes longer by road".

### Step B: the commander decides (human in the loop)

File: `server/src/modules/dispatch/dispatch.service.ts` → `decide()`

In **one database transaction**, with row locks (`SELECT ... FOR UPDATE`) so two commanders clicking at the
same moment cannot double-book a unit:

1. the decision must still be `pending`
2. the incident must still be `open`
3. the chosen unit must still be `available` and not retired
4. unit → `en_route`, linked to the incident; incident → `dispatched`; decision → `accepted` or `overridden`
   (with the commander's reason)

Afterwards: audit log entry, live push to all dashboards, and a `task:assigned` message to the responder
account linked to that unit.

### Step C: lifecycle

File: `server/src/modules/incidents/incidents.service.ts` → `updateIncidentStatus()`

| Action | Incident | Unit(s) |
|---|---|---|
| Mark as arrived | `on_scene` | `on_scene`, position moved to the incident |
| Mark as resolved | `resolved` | `available`, unlinked |

---

## 6. Database

Schema: `server/src/db/migrations/001_init.sql`

```
users ───────────────┐ resource_id (responder's unit)
                     ▼
resources ◀───── assigned_incident_id ─────▶ incidents ◀──── incident_id ──── reports
    ▲                                            ▲
    │ recommended_resource_id / resource_id      │ incident_id
    └──────────────── dispatch_decisions ────────┘

audit_log  (actor, action, entity_type + entity_id, summary, details, created_at)
```

| Table | Key columns (SRS §7) |
|---|---|
| `reports` | source, text, location, image_url, reported_at, incident_id |
| `incidents` | type, severity, urgency_score, status, location, report_count, confidence, needs_review, created_at |
| `resources` | type, location, status, capacity, current_load, capabilities[], assigned_incident_id |
| `dispatch_decisions` | incident_id, recommended_resource_id, resource_id, agent_recommendation (JSON), human_action, rationale, created_at, decided_at |
| `users` | name, email, password_hash, role, resource_id |
| `audit_log` | every agent decision and human response, with timestamps |

**Locations** are `GEOGRAPHY(POINT, 4326)`: GPS coordinates where PostGIS measures in metres. Each location
column has a **GIST index**, so these queries use the index instead of checking every row (the SRS's "proper
geospatial indexing, not naive distance loops"):

- `ST_DWithin(a, b, 500)`: "within 500 m" (deduplication)
- `a <-> b` in `ORDER BY`: "nearest first" (KNN search for the Dispatch Agent)

Allowed values (roles, statuses, types) are enforced with `CHECK` constraints and mirrored in
`server/src/domain.ts`.

---

## 7. Real-time events

File: `server/src/realtime/socket.ts`

| Event | Sent to | When |
|---|---|---|
| `incident:updated` | control room (commanders + admins) | incident created, merged, reviewed, dispatched, status changed |
| `resource:updated` | control room | unit added, edited, retired, dispatched, freed |
| `decision:updated` | control room | recommendation created or answered |
| `feed:status` | control room | social feed started, paused, progressed |
| `task:assigned` | the responder linked to the unit | a commander dispatched that unit |

The browser opens one connection after login (`client/src/hooks/SocketContext.tsx`), sending its JWT. The
server rejects connections without a valid token. `useLiveData.ts` loads everything once over REST, then
applies these events; after a reconnect it reloads everything in case something was missed.

---

## 8. Frontend structure

```
App.tsx (routes + role guards)
 └─ Layout (top bar, live indicator)
     ├─ DashboardPage
     │   ├─ FeedControl          start / pause the social feed
     │   ├─ IncidentList         the queue
     │   ├─ MapView              Leaflet map, route line
     │   └─ IncidentPanel        details of the selected incident
     │       ├─ ClassificationReview
     │       └─ DispatchSection  recommend / send / override / arrived / resolved
     │      (or ResourcePanel when nothing is selected)
     ├─ NewReportPage            form + LocationPicker + address search
     ├─ ResourcesPage            table + ResourceForm drawer (admin)
     └─ ResponderPage            responder's unit (full view at end-term)
```

During development, Vite (port 5173) forwards `/api` and `/socket.io` to the backend (port 4000), so the
browser only talks to one address (`client/vite.config.ts`).

---

## 9. Security measures

- Passwords stored as **bcrypt** hashes, never in plain text.
- **JWT** on every API request and on the WebSocket connection; tokens expire (`JWT_EXPIRES_IN`, 12 h).
- **Role checks on the server** (`requireRole`), not just hidden buttons. For example, an admin calling the
  dispatch API gets `403`.
- **Input validation** with zod on every endpoint, plus `CHECK` constraints in the database.
- **Parameterised SQL** (`$1, $2...`) everywhere, which prevents SQL injection.
- `helmet` security headers, CORS limited to the client's address.
- Same error message for "wrong email" and "wrong password", so emails cannot be probed.

---

## 10. SRS → code map

| SRS section | Where |
|---|---|
| 2 User roles | `middleware/auth.ts`, `client/src/App.tsx` |
| 3 REST + WebSockets | `app.ts`, `realtime/socket.ts` |
| 4.1 Report ingestion (form, social feed) | `modules/reports/`, `modules/feeds/`, `client/src/pages/NewReportPage.tsx` |
| 4.1 Deduplication | `reports.service.ts → attachToIncident()` |
| 4.2 Triage Agent | `agents/triage/` |
| 4.3 Incident queue | `incidents.service.ts → listActiveIncidents()`, `client/src/components/IncidentList.tsx` |
| 4.4 Resource inventory | `modules/resources/`, `client/src/pages/ResourcesPage.tsx` |
| 4.5 Dispatch Agent | `agents/dispatch/`, `modules/dispatch/` |
| 4.6 Routing Agent | `agents/routing/routingAgent.ts` |
| 4.7 Audit log | `modules/audit/audit.service.ts` |
| 4.8 Command dashboard | `client/src/pages/DashboardPage.tsx` and its components |
| 4.9 Responder view (basic) | `client/src/pages/ResponderPage.tsx` |
| 5 Explainability | `urgency.ts` reason, triage `reason`, dispatch `rationale` |
| 5 Human override | `dispatch.service.ts → decide()` |
| 5 Geospatial indexing | GIST indexes in `001_init.sql`, `ST_DWithin` and `<->` queries |
