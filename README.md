# Disaster Response Resource Coordinator

An AI-driven command-and-control platform for disaster response teams. It ingests
incident reports from multiple channels, uses a multi-agent system to triage and
prioritise them, and recommends the dispatch and routing of physical resources —
with a human commander able to review, override, or approve every agent decision.

Built to the attached software requirements specification (`Team size: 3,
Duration: ~1 semester`).

---

## Run it

You need Python 3.11+. Node is only needed if you want to change the frontend —
a production build is already included.

```bash
cd backend
pip install -r requirements.txt
python run.py
```

Open **http://localhost:8000** and sign in as `commander` / `commander123`.

That is the whole setup. No database server, no API key, no routing service. The
system boots with a flood scenario already seeded, agents running, and vehicles
moving on the map.

### Demo accounts

| Username | Password | Role | What they see |
|---|---|---|---|
| `commander` | `commander123` | Commander | Full dashboard, approves dispatch |
| `responder1` | `responder123` | Field responder | Mobile view for Ambulance 01 |
| `responder2` | `responder123` | Field responder | Engine 11 |
| `responder3` | `responder123` | Field responder | Rescue Team A |
| `admin` | `admin123` | Admin | Resource inventory management |

### Frontend development

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api and /ws to :8000
npm run build      # rebuilds frontend/dist, which the backend serves
```

### Tests

```bash
pip install pytest
python -m pytest tests/ -q     # 63 tests
```

---

## Runs anywhere, scales up where it matters

Every external dependency in the specification is optional, and each one has a
working local fallback. This is a deliberate design choice, not a shortcut: a
command system that stops working when an API key expires or the network drops
is the wrong shape for the problem. Each layer announces which mode it is in,
both in the status bar and in the decision log.

| Layer | Default (zero setup) | Production path | Switch with |
|---|---|---|---|
| Agent reasoning | Deterministic keyword/rule classifiers | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| Road routing | Road-factor estimator with synthetic geometry | OSRM road network | `OSRM_URL` |
| Database | SQLite | PostgreSQL + PostGIS | `DATABASE_URL` |
| Geospatial index | In-process grid hash | GiST index + `ST_DWithin` | follows `DATABASE_URL` |
| Hazard feed | Synthetic generator | Open-Meteo compatible API | `WEATHER_API_URL` |

Copy `backend/.env.example` to `backend/.env` to change any of these.

---

## Architecture

```
 Report sources                Agent layer                     Human
 ─────────────                 ───────────                     ─────
 Manual intake ─┐
 Social feed   ─┼──▶ Triage Agent ──▶ Incident Queue ──┐
 Weather feed  ─┘    (classify,        (urgency +      │
                      dedup)            ageing)        ▼
                                                  Supervisor ◀──▶ Commander
                                                  (orchestrate,    (approve /
                                                   conflicts,       override /
                                                   escalation)      reject)
                                                       │
                                      Dispatch Agent ◀─┘
                                      (candidates, load)
                                             │
                                       Routing Agent
                                       (ETAs, detours,
                                        multi-stop)
                                             │
                                    Vehicle Simulation
                                             │
                                   Live map + Responder app
```

REST carries CRUD; a WebSocket carries live incident and vehicle state. The
Supervisor is the only component that mutates shared state, which is what keeps
the audit log complete.

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## How the specification maps to the code

| Spec | Feature | Where |
|---|---|---|
| 4.1 | Report ingestion, three channels | `services/ingestion.py`, `routers/incidents.py` |
| 4.1 | Deduplication | `services/dedup.py` |
| 4.2 | Triage Agent | `agents/triage.py` |
| 4.3 | Queue, urgency, merge/split | `services/queue.py` |
| 4.4 | Resource inventory | `models.py`, `routers/resources.py` |
| 4.5 | Dispatch Agent | `agents/dispatch.py` |
| 4.6 | Routing Agent, multi-stop, re-routing | `agents/routing.py` |
| 4.7 | Supervisor / orchestrator | `agents/supervisor.py`, `services/orchestrator.py` |
| 4.8 | Command dashboard | `frontend/src/App.jsx`, `components/` |
| 4.9 | Responder view | `components/ResponderView.jsx`, `routers/responder.py` |
| 4.10 | Vehicle simulation | `services/simulation.py` |
| 4.11 | Notifications | `events.py` + toast layer |
| 4.12 | After-action analytics | `services/analytics.py`, `components/Analytics.jsx` |

### Non-functional requirements

- **Real-time performance** — state changes are pushed the moment they happen,
  so propagation is bounded by network latency, not a poll interval.
- **Explainability** — no recommendation is stored without a human-readable
  rationale naming the unit, its ETA, and why it beat the runner-up.
- **Human override** — only an approval creates an assignment. Severity ≥ 4 can
  never be auto-approved, regardless of configuration. There is a test for this.
- **Auditability** — every agent decision and human response is written to an
  append-only log with a timestamp and an actor.
- **Geospatial accuracy** — proximity searches use a spatial index (grid hash or
  PostGIS GiST), never a scan over every row. There is a test asserting the
  index returns exactly what a brute-force scan would.

---

## What the agents actually do

**Triage** classifies free text into one of nine incident types with a severity
and a confidence. Single keywords are ambiguous — "collapsed" means a building
in one sentence and a person in the next — so phrase-level context rules carry
more weight than individual words. Hedging language ("maybe", "not sure") lowers
confidence, which pushes vague reports below the review threshold instead of
letting them through as fact. Anything under the threshold is flagged for a
human rather than silently guessed at.

**Dispatch** shortlists candidates using the spatial index, filters by capability
and availability, then asks the Routing Agent for *real* ETAs on the top three
before ranking. This is what stops "nearest" from silently winning: a unit 400 m
closer across a blocked bridge is not closer in the way that matters.

**Routing** returns road geometry and ETAs, plans multi-stop supply runs ordered
by a priority-weighted nearest-neighbour walk, and detours around reported
closures. Reporting a blocked road replans every in-flight route through it.

**Supervisor** runs the others on a timer, detects when two incidents want the
same unit and gives it to the more urgent one, escalates on low confidence or
high severity, and writes everything to the log.

---

## Demo

See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) for a timed walkthrough covering
the burst of incoming reports, live triage, an approval, an override, a road
closure forcing a re-route, and the after-action numbers.

Quick version, from the dashboard:

1. **Reset** — clears everything and re-seeds the fleet.
2. **Inject report** — one synthetic social post; watch it triage and either open
   an incident or merge into an existing one.
3. Pick a queue row with **AWAITING YOU** and read the agent's reasoning.
4. **Approve** — the unit starts moving on the map immediately.
5. **Block a road**, then click on an active route — watch the log record the
   re-route and the ETA change.
6. Sign in as `responder1` in another window to see the same job from the field.
7. **After action** tab — response times and the agent acceptance rate.

---

## Team split

The module boundaries follow section 8 of the specification. See
[`docs/TEAM_SPLIT.md`](docs/TEAM_SPLIT.md) for the file-level breakdown of who
owns what.

## Project layout

```
backend/
  app/
    agents/       triage, dispatch, routing, supervisor, LLM adapter
    services/     ingestion, dedup, queue, simulation, orchestrator, analytics
    routers/      auth, incidents, resources, dispatch, responder, system
    models.py     ORM  ·  schemas.py  API contracts  ·  geo.py  spatial index
    events.py     WebSocket bus  ·  security.py  JWT + RBAC
  run.py          entry point
frontend/
  src/            React app; components/, lib/
  dist/           prebuilt, served by the backend
tests/            63 tests
docs/             architecture, API reference, demo script, team split
```
