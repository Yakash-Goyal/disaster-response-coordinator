# Team split

Following section 8 of the specification. Each member owns a vertical slice with
a clear interface to the others, so the three can work in parallel without
stepping on each other.

## Member A — Ingestion & Triage

**Owns**

| File | What |
|---|---|
| `services/ingestion.py` | Three inbound channels and their background workers |
| `services/dedup.py` | Location/time/text matching that collapses duplicates |
| `agents/triage.py` | Classification, severity, confidence, review threshold |
| `services/queue.py` | Urgency scoring, ageing, merge and split |
| `routers/incidents.py` | Report intake and queue endpoints |

**Interface to the rest of the system:** `supervisor.handle_report()` returns a
triaged `Incident`. Nothing downstream cares how it was classified.

**Tests:** `test_triage.py`, `test_dedup.py`, `test_queue.py`

**Where the real work is:** disambiguating single keywords with phrase context,
and calibrating confidence so vague reports fall below the review threshold
rather than through it. The dedup threshold matters too — a false merge hides a
real incident, which is worse than a duplicate, so the bar is set high.

---

## Member B — Agent Orchestration & Dispatch

**Owns**

| File | What |
|---|---|
| `agents/supervisor.py` | Orchestration, conflict resolution, escalation, audit |
| `agents/dispatch.py` | Candidate scoring, real-ETA ranking, rationale |
| `agents/routing.py` | OSRM adapter, estimator, detours, multi-stop |
| `agents/llm.py` | Provider abstraction and circuit breaker |
| `services/orchestrator.py` | The dispatch heartbeat |
| `routers/dispatch.py` | Approve / override / reject endpoints |

**Interface:** `dispatch.recommend(db, incident)` returns a `Recommendation`.
The Supervisor decides what happens to it.

**Tests:** `test_dispatch.py`, `test_routing.py`

**Where the real work is:** the two-stage ranking — cheap spatial pre-filter,
then true routed ETAs on the shortlist only — and the escalation rules that keep
a human on every consequential decision.

---

## Member C — Real-time Systems & Frontend

**Owns**

| File | What |
|---|---|
| `events.py` | WebSocket manager and typed event bus |
| `services/simulation.py` | Vehicle GPS simulation and arrival handling |
| `services/analytics.py` | After-action metrics |
| `routers/responder.py`, `routers/system.py` | Responder API, logs, analytics, WS |
| `frontend/` | Entire React application |

**Interface:** `bus.publish(topic, data)`. Any component can emit; only this
layer knows about sockets.

**Tests:** `test_api.py` (transport and RBAC)

**Where the real work is:** driving Leaflet imperatively so a dozen units
pinging every second do not cause the map to flicker, and reconciling REST
snapshots with incremental WebSocket events in one hook.

---

## Shared

`models.py`, `schemas.py`, `config.py`, `database.py`, `geo.py`, `security.py`.
Agree changes to `models.py` and `schemas.py` between all three — they are the
contract everything else is written against.

## Suggested 12-week schedule

| Weeks | A | B | C |
|---|---|---|---|
| 1–2 | Data model, intake endpoint | Resource model, spatial index | Auth, app shell |
| 3–4 | Keyword triage, dedup | Candidate scoring | WebSocket bus, live map |
| 5–6 | Urgency + ageing, queue API | Routing adapter + estimator | Vehicle simulation |
| 7–8 | LLM triage + cross-check | Supervisor, conflicts, escalation | Decision panel, responder view |
| 9–10 | Merge/split, social + weather feeds | Multi-stop, re-routing | Analytics, audit log UI |
| 11 | Scenario seeding | Integration, tuning | Polish, responsive layout |
| 12 | Report, demo rehearsal, evaluation numbers | | |
