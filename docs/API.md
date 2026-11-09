# API reference

Base URL during development: `http://localhost:4000/api` (the web app reaches it through `/api`).

- All bodies are JSON.
- Every endpoint except `/health` and `/auth/login` needs the header `Authorization: Bearer <token>`.
- Errors always look like `{ "error": "Readable message" }` with a matching HTTP status:
  `400` invalid input, `401` not logged in / session expired, `403` wrong role, `404` not found,
  `409` conflict (e.g. unit no longer available), `500` unexpected server error.

Roles: **C** = commander, **A** = admin, **R** = responder.

---

## Auth

| Method | Path | Roles | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` | `{ token, user }` |
| GET | `/auth/me` | any | | `{ user }` |

## System

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/health` | public | `{ ok: true }` |
| GET | `/system` | any | `{ triageMode: "ai" \| "rules", aiModel }` |

## Reports

| Method | Path | Roles | Body | Returns |
|---|---|---|---|---|
| POST | `/reports` | C, A | `{ text (10–2000 chars), lat, lng, address?, reporter? }` | `{ reportId, incident, merged, triage }` |
| GET | `/reports/recent` | C, A | | `{ reports }` (latest 30, all channels) |

`POST /reports` runs the whole pipeline (triage → deduplication → incident). `merged: true` means the report
was added to an existing incident.

## Incidents

| Method | Path | Roles | Body | Returns |
|---|---|---|---|---|
| GET | `/incidents` | C, A | | `{ incidents }`: active queue, most urgent first |
| GET | `/incidents?view=resolved` | C, A | | `{ incidents }`: last 50 resolved |
| GET | `/incidents/:id` | C, A | | `{ incident, reports, history }` |
| PUT | `/incidents/:id/classification` | C | `{ type, severity }` | `{ incident }` (commander review) |
| POST | `/incidents/:id/status` | C | `{ status: "on_scene" \| "resolved" }` | `{ incident }` (resolving an open incident closes it without a unit) |

Incident fields: `id, title, type, severity (1–5), urgencyScore (0–100), urgencyReason, status, lat, lng,
address, reportCount, confidence (0–1), needsReview, classifiedBy ("ai" | "rules" | "commander"),
triageReason, createdAt, updatedAt, lastReportAt, dispatchedAt, resolvedAt, assignedUnits[], pendingDecisionId`.

## Dispatch

| Method | Path | Roles | Body | Returns |
|---|---|---|---|---|
| POST | `/dispatch/incidents/:id/recommend` | C | | `{ decision, message }`: `decision` is `null` with a `message` if no unit is free |
| GET | `/dispatch/incidents/:id/decisions` | C, A | | `{ decisions }` newest first |
| POST | `/dispatch/decisions/:id/accept` | C | | `{ decision }` |
| POST | `/dispatch/decisions/:id/override` | C | `{ resourceId, reason? }` | `{ decision }` |
| GET | `/dispatch/route?resourceId=&incidentId=` | C, A | | `{ route: { durationSeconds, distanceMeters, source, path } }` |

Decision fields: `id, incidentId, recommendedResourceId, resourceId, recommendation { requirement,
candidates[] }, rationale, humanAction ("pending" | "accepted" | "overridden" | "superseded"),
overrideReason, decidedByName, createdAt, decidedAt`.

Each candidate: `resourceId, code, name, type, lat, lng, straightLineMeters, etaSeconds, roadMeters,
etaSource ("osrm" | "estimate"), matchedCapabilities, missingCapabilities, loadRatio, score`.

## Resources

| Method | Path | Roles | Body | Returns |
|---|---|---|---|---|
| GET | `/resources` | C, A | `?includeRetired=true` optional | `{ resources }` |
| GET | `/resources/summary` | C, A | | `{ summary: [{ type, status, count }] }` |
| GET | `/resources/:id` | C, A, R (own unit only) | | `{ resource }` |
| POST | `/resources` | A | resource body | `{ resource }` |
| PUT | `/resources/:id` | A | resource body | `{ resource }` |
| POST | `/resources/:id/retire` | A | | `{ resource }` |
| POST | `/resources/:id/restore` | A | | `{ resource }` |

Resource body: `{ code, name, type, status, lat, lng, homeBase, capacity, currentLoad, capabilities[] }`.
`type`: ambulance | supply_truck | personnel | shelter.
`status`: available | en_route | on_scene | out_of_service.
`capabilities`: advanced_life_support, trauma_kit, water_rescue, fire_fighting, search_and_rescue,
heavy_equipment, electrical_repair, food_and_water, medical_supplies.

Rules: codes are unique, `currentLoad ≤ capacity`, and the status of a unit on an active incident cannot be
changed (resolve the incident first).

## Mock social feed

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/feeds/social` | C, A | `{ status: { running, posted, total, intervalSeconds } }` |
| POST | `/feeds/social/start` | C, A | `{ status }` |
| POST | `/feeds/social/stop` | C, A | `{ status }` |
| POST | `/feeds/social/rewind` | C, A | `{ status }` |

## Geocoding (proxy to OpenStreetMap Nominatim)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/geocode/search?q=` | any | `{ results: [{ label, lat, lng }] }` (max 5, Chennai preferred) |
| GET | `/geocode/reverse?lat=&lng=` | any | `{ label }` |

Requests are spaced at least 1.1 s apart and cached, following Nominatim's usage policy.

---

## WebSocket events (Socket.IO, same port)

Connect with `io({ auth: { token } })`. See [ARCHITECTURE.md §7](ARCHITECTURE.md#7-real-time-events).

| Event | Payload |
|---|---|
| `incident:updated` | Incident |
| `resource:updated` | Resource |
| `decision:updated` | Dispatch decision |
| `feed:status` | Feed status |
| `task:assigned` | `{ incident, resource }` (only to the responder of that unit) |

---

## Try it with curl

```bash
# log in
curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"commander@drrc.local\",\"password\":\"Commander@123\"}"

# use the token from the answer
curl http://localhost:4000/api/incidents -H "Authorization: Bearer <token>"
```
