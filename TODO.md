# Disaster Response Resource Coordinator — Project To-Do List

Built from the SRS ("Disaster Response Resource Coordinator — Software Requirements & Feature Specification").
Each task lists the SRS section it covers.

**Chosen stack** (decided with the team):

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite), Leaflet + OpenStreetMap |
| Backend | Node.js + Express + TypeScript |
| Agent orchestration | LangGraph.js, backed by Google Gemini (with a rule-based fallback) |
| Database | PostgreSQL 17 + PostGIS 3.6 |
| Real-time | WebSockets (Socket.IO) |
| Routing engine | OSRM (public server now; self-hosted is a config change) |
| Weather / hazard feed | Open-Meteo |
| Auth | JWT, role-based (commander / responder / admin) |
| Demo city | Chennai |

Legend: **[MID]** = built for mid-term evaluation, **[END]** = planned for end-term.
Status: `[x]` done, `[ ]` pending. Last updated: 4 Oct 2026 (mid-term build complete).

---

## Phase 0: Foundation

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 1 | Install PostgreSQL + PostGIS, create the `drrc` database | §6 | MID | [x] |
| 2 | Project scaffold: `server/` (Express + TS), `client/` (React + Vite + TS), root run scripts | §6 | MID | [x] |
| 3 | Environment config with validation (`.env.example`, fail fast on bad config) | — | MID | [x] |
| 4 | Database schema + migration runner: users, resources, reports, incidents, dispatch decisions, audit log, with GIST spatial indexes | §7, §5 | MID | [x] |
| 5 | Seed data: one user per role plus responders; Chennai ambulances, supply trucks, personnel teams, shelters | §4.4, §9 | MID | [x] |

## Phase 1: Authentication & Roles

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 6 | Backend JWT login (bcrypt-hashed passwords) + role-guard middleware | §6 Auth | MID | [x] |
| 7 | Frontend login page, session handling, role-based routing and layout | §2 | MID | [x] |

## Phase 2: Report Ingestion (§4.1)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 8 | Report API + manual report form (citizen simulation): pick a location on the map or type an address (geocoded with OSM Nominatim) | §4.1 | MID | [x] |
| 9 | Optional image attachment on reports (upload, store, show) | §4.1, §7 | END | [ ] |
| 10 | Mock social-media feed: synthetic Chennai posts replayed on a timer, started/stopped from the dashboard | §4.1 | MID | [x] |
| 11 | Weather/hazard feed: poll Open-Meteo, turn heavy rain / high wind into hazard reports | §4.1 | END | [ ] |
| 12 | Deduplication: reports within a distance/time radius merge into one incident (PostGIS `ST_DWithin`); report count shown as a severity signal | §4.1 | MID | [x] |

## Phase 3: Triage Agent (§4.2)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 13 | Triage Agent as a LangGraph graph: Gemini classifies incident type + severity + confidence from free text | §4.2 | MID | [x] |
| 14 | Rule-based keyword fallback when no API key or the LLM call fails (always marked low-confidence) | §4.2 | MID | [x] |
| 15 | Urgency score from severity, number of corroborating reports, and incident type | §4.2 | MID | [x] |
| 16 | Low-confidence classifications flagged "Needs review"; commander can confirm or correct type/severity | §4.2 | MID | [x] |

## Phase 4: Incident Queue & Prioritization (§4.3)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 17 | Live incident queue ranked by urgency (API + real-time updates) | §4.3 | MID | [x] |
| 18 | Urgency aging: background job raises the priority of unaddressed incidents over time | §4.3 | END | [ ] |
| 19 | Commander manual re-prioritization | §4.3 | END | [ ] |
| 20 | Commander merge / split incidents | §4.3 | END | [ ] |

## Phase 5: Resource Inventory & Admin (§4.4, §2)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 21 | Resource API: add / edit / retire; type, location (PostGIS point), status, capacity, capabilities | §4.4 | MID | [x] |
| 22 | Admin panel: resource management screen | §4.4, §2 | MID | [x] |
| 23 | Admin panel: user account management | §2 | END | [ ] |

## Phase 6: Routing Agent (§4.6)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 24 | OSRM client: road route + ETA for a resource→incident pair (straight-line estimate fallback if OSRM is unreachable, clearly labelled) | §4.6 | MID | [x] |
| 25 | Multi-stop routing for supply trucks serving several incidents/shelters in one trip | §4.6 | END | [ ] |
| 26 | Live re-routing when a road is reported blocked or a higher-priority incident interrupts | §4.6 | END | [ ] |

## Phase 7: Dispatch Agent (§4.5)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 27 | Candidate search: nearest available resources via PostGIS KNN (`<->` operator on a GIST index), filtered by capability match and current load | §4.5, §5 | MID | [x] |
| 28 | Ask the Routing Agent for real ETAs of the top candidates, rank them, write a plain-language rationale (e.g. "Unit 4 recommended: 3 min closer than Unit 7, carries required equipment") | §4.5, §5 | MID | [x] |
| 29 | Commander approves or overrides (picks another unit) → resource and incident status update | §4.5, §5 | MID | [x] |

## Phase 8: Supervisor Agent (§4.7)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 30 | Supervisor (LangGraph) orchestrating Triage → Dispatch → Routing as one graph | §4.7 | END | [ ] |
| 31 | Conflict detection & resolution (two incidents wanting the same nearest unit) | §4.7 | END | [ ] |
| 32 | Escalation policy: low confidence, high stakes, or conflicting recommendations always go to the commander | §4.7, §5 | END | [ ] |
| 33 | Audit log: every agent decision and every human response stored with timestamps | §4.7, §5 | MID | [x] |

## Phase 9: Command Dashboard (§4.8)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 34 | Live map of active incidents and resource positions | §4.8 | MID | [x] |
| 35 | Incident queue panel with the agent's recommendation and one-click accept / override | §4.8 | MID | [x] |
| 36 | Resource status panel (available / en route / on scene / out of service) | §4.8 | MID | [x] |
| 37 | Decision log / audit trail page | §4.8 | END | [ ] |

## Phase 10: Responder View (§4.9)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 38 | Mobile-first responder page showing the currently assigned incident and its details | §4.9 | END | [ ] |
| 39 | Route / navigation on the responder's map | §4.9 | END | [ ] |
| 40 | Status controls: en route → on scene → resolved, pushed live to the dashboard and Supervisor | §4.9 | END | [ ] |

## Phase 11: Vehicle Simulation (§4.10)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 41 | Simulate GPS movement of resources along their OSRM route over WebSockets at a configurable speed | §4.10 | END | [ ] |

## Phase 12: Notifications (§4.11)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 42 | Real-time in-app alerts to the commander for new high-severity incidents | §4.11 | END | [ ] |
| 43 | Real-time in-app alert to a responder when an incident is assigned to them | §4.11 | END | [ ] |

## Phase 13: Analytics / After-Action View (§4.12)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 44 | After-action page: response time per incident, resource utilization, AI recommendation acceptance rate | §4.12 | END | [ ] |

## Phase 14: Real-time Infrastructure (§3, §5)

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 45 | Socket.IO server with JWT-authenticated connections; push incident and resource changes to connected clients within ~1–2 s | §3, §5 | MID | [x] |

## Phase 15: Quality & Delivery

| # | Task | SRS | Term | Status |
|---|---|---|---|---|
| 46 | Input validation (zod), central error handling, request logging | — | MID | [x] |
| 47 | Automated tests: urgency score, dedup, fallback classifier, dispatch ranking, API endpoints | — | END | [ ] |
| 48 | Full flood demo scenario: one click seeds a burst of reports across Chennai | §9 | END | [ ] |
| 49 | Documentation: README, setup guide, architecture, API reference, team learning guide | — | MID (core) / END (complete) | [x] core / [ ] complete |
| 50 | Production build + deployment (serve the built client from Express, process manager / Docker) | — | END | [ ] |

---

## Summary

- **Mid-term (28 tasks, of which 1–5 are one-time setup):** 1–8, 10, 12–17, 21, 22, 24, 27–29, 33–36, 45, 46, 49 (core)
- **End-term (22 tasks + completing 49):** 9, 11, 18–20, 23, 25, 26, 30–32, 37–44, 47, 48, 50

Counting feature work only (excluding setup tasks 1–5), mid-term covers 23 of 45 tasks, about half.

**What the mid-term demo shows, end to end:**
log in → reports arrive (manual form + mock social feed) → Triage Agent classifies them → duplicates merge → incident queue ranked by urgency → live map → Dispatch Agent recommends a unit with real road ETA and a plain-language reason → commander accepts or overrides → statuses update live and the decision is logged.

**Groundwork already in place for end-term tasks:**
- #38: a basic responder page shows the responder's unit, its status and its assigned incident number.
- #43: the server already sends a `task:assigned` live message to the responder when their unit is dispatched; the screen that shows it comes with the responder view.
- #44: response times (`created_at`, `dispatched_at`, `resolved_at`) and accept/override decisions are already stored, ready for the analytics page.
