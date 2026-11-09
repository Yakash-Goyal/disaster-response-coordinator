# Improvement scope

What comes next: first the planned end-term features from the SRS, then improvements to the parts already
built, and finally the honest limitations of the current version.

---

## 1. End-term plan (remaining SRS features)

Task numbers refer to [TODO.md](../TODO.md).

| # | Feature | SRS | Short plan |
|---|---|---|---|
| 30–32 | **Supervisor Agent** | 4.7 | One LangGraph graph: Triage → Dispatch → Routing. Detect two incidents competing for the same unit, resolve by urgency, escalate low confidence / high stakes / conflicts to the commander. |
| 38–40 | **Responder mobile view** | 4.9 | Assigned incident, route on the map, big buttons "On my way / Arrived / Resolved" that push live to the dashboard. `task:assigned` is already sent today. |
| 41 | **Vehicle simulation** | 4.10 | Move units along their OSRM route path over WebSockets at a configurable speed. Route paths are already returned by `getRoute()`. |
| 42–43 | **Notifications** | 4.11 | In-app alert to commanders for new severity 4–5 incidents; alert to the responder on assignment. |
| 44 | **After-action analytics** | 4.12 | Response time per incident (`created_at → dispatched_at → resolved_at`, already stored), unit utilisation, AI acceptance rate (`accepted` vs `overridden` in `dispatch_decisions`, already stored). |
| 11 | **Weather / hazard feed** | 4.1 | Poll Open-Meteo for Chennai; heavy rain or strong wind becomes a `weather_api` report (the source value already exists in the schema). |
| 9 | **Image on reports** | 4.1 | Upload with the form; `reports.image_url` already exists. |
| 18 | **Urgency aging** | 4.3 | Background job: unaddressed incidents gain points every few minutes. |
| 19–20 | **Re-prioritise, merge / split** | 4.3 | Commander tools on the incident panel. |
| 23 | **User management** | 2 | Admin screen to add users and link responders to units. |
| 25–26 | **Multi-stop and live re-routing** | 4.6 | OSRM `trip` service for supply trucks; re-route when a road is reported blocked. |
| 37 | **Decision log page** | 4.8 | Searchable table over `audit_log`; the data is already recorded. |
| 47–50 | **Tests, demo scenario, deployment** | — | Unit tests (urgency, rules, dedup, ranking), API tests, one-click flood scenario, production build. |

---

## 2. Improvements to what is already built

### Scalability

| Today | Improvement | Why |
|---|---|---|
| Public OSRM demo server | **Self-hosted OSRM** with Chennai / Tamil Nadu map data (Docker) | No rate limits, works offline, faster. Only `OSRM_URL` in `.env` changes. |
| Public Nominatim, in-memory cache | Self-hosted geocoder or a paid API; cache in the database or Redis | Nominatim allows 1 request/s; the cache is lost on restart. |
| Reports triaged inside the web server | **Job queue** (e.g. BullMQ + Redis) with worker processes | A burst of thousands of reports would not slow the API. |
| Dedup serialised by an in-memory queue | PostgreSQL **advisory lock** (or the job queue) | Works across several server instances. |
| One Socket.IO server | **Redis adapter** for Socket.IO | Run many servers behind a load balancer; events still reach every screen. |
| Full lists returned | **Pagination** for resolved incidents, history, resources | Keeps responses small at city scale. |
| GIST index on all incidents | Extra **partial index** `WHERE status <> 'resolved'` | Dedup and queue queries skip old incidents. |
| ETAs fetched each time | Short-lived **ETA cache** per unit-incident pair | Fewer routing calls during bursts. |
| One JavaScript bundle (~500 kB) | **Code-splitting** per page | Faster first load on slow mobile networks. |

### Small feature additions

- **Incoming reports list** on the dashboard (the API `GET /api/reports/recent` already exists).
- **Search and filters** in the queue by type and area.
- **More than one unit per incident** (e.g. a boat and an ambulance for a flood with injuries).
- **Nearest shelter with free space** suggestion for evacuations (shelter capacity and occupancy are already stored).
- **Return to base** for units after an incident is resolved.
- **Tamil language** support in the triage prompt and the interface.
- **Printable incident summary** for handover between shifts.

### Security

- Rate limiting and lockout on the login endpoint.
- Token in an httpOnly cookie instead of `localStorage`, plus refresh tokens.
- Password change and reset; force a password change on first login.
- HTTPS and secure headers in production.

### AI quality

- Build an **evaluation set** of labelled reports and measure accuracy of AI vs keyword rules.
- Add a few example reports (few-shot) to the prompt for better Indian-English / Tanglish understanding.
- Tune the urgency weights using after-action analytics (acceptance rate, response times).

### Engineering

- Automated tests and a CI pipeline (type-check, lint, tests on every push).
- Docker Compose to start PostgreSQL + PostGIS + server + client with one command.
- Structured logging (e.g. pino) and basic monitoring.

---

## 3. Known limitations of the mid-term version

Stated honestly, so nobody is surprised during the demo:

1. **Single server instance**: the dedup queue, social-feed progress and geocoding cache live in memory.
2. **Internet needed** for map tiles, OSRM and Nominatim (the app falls back to estimates if routing fails).
3. **Units do not move** on the map yet; a unit jumps to the incident when marked "arrived" (simulation is end-term).
4. **One unit per incident.**
5. **Keyword fallback is basic**: it can misread context (e.g. "neighbours are trying to help" raises
   severity). That is exactly why its results are always marked "Needs checking", and why the AI mode exists.
6. **Responder view is minimal**: shows the unit and its task number; the full mobile view is end-term.
7. **Commander marks "arrived" and "resolved"** on behalf of responders until the responder view is built.
