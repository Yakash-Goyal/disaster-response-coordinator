# API reference

Base URL `http://localhost:8000`. Interactive docs at `/docs`.

All endpoints except `/api/health` and `/api/auth/login` require
`Authorization: Bearer <token>`.

## Auth

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{username, password}` → token + user |
| POST | `/api/auth/token` | — | OAuth2 form flow, used by `/docs` |
| GET | `/api/auth/me` | any | Current user |

## Reports (spec 4.1)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/reports` | any | Intake. Triages and deduplicates. Returns `{report, incident_id, merged, triage}` |
| GET | `/api/reports` | any | `?limit=&incident_id=&source=` |

## Incidents (spec 4.3)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/incidents` | any | Ranked queue. `?status=&open_only=&limit=` |
| GET | `/api/incidents/{id}` | any | Detail with reports, decisions, assigned units |
| PATCH | `/api/incidents/{id}` | commander | Override type, severity, status, `manual_priority` |
| POST | `/api/incidents/{id}/resolve` | commander | Close and release units |
| POST | `/api/incidents/merge` | commander | `{source_incident_id, target_incident_id}` |
| POST | `/api/incidents/{id}/split` | commander | `{report_ids: [...]}` |

## Resources (spec 4.4)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/resources` | any | `?status=&type=` |
| GET | `/api/resources/{id}` | any | |
| POST | `/api/resources` | admin | Add a unit |
| PATCH | `/api/resources/{id}` | commander | Status, capabilities, position |
| DELETE | `/api/resources/{id}` | admin | Retire. 409 if the unit is mid-job |
| POST | `/api/resources/multi-stop` | commander | `{resource_id, incident_ids}` → one routed run |

## Dispatch (spec 4.5, 4.7)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/dispatch/decisions` | any | `?pending_only=&incident_id=&limit=` |
| GET | `/api/dispatch/decisions/{id}` | any | |
| POST | `/api/dispatch/decisions/{id}/action` | commander | `{action: accept\|override\|reject, resource_id?, note?}` — **the only path that moves a vehicle** |
| POST | `/api/dispatch/run` | commander | Run a cycle now instead of waiting for the tick |
| POST | `/api/dispatch/recommend` | commander | `{incident_id, force}` — fresh recommendation for one incident |
| GET | `/api/dispatch/candidates/{incident_id}` | commander | Everything the agent scored, for informed overrides |
| POST | `/api/dispatch/preempt` | commander | `?incident_id=&resource_id=` — pull a unit off a lesser job |

## Responder (spec 4.9)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/responder/task` | responder | Current assignment, route, ETA, instructions |
| POST | `/api/responder/status` | responder | `{status: en_route\|on_scene\|resolved\|available\|out_of_service, note?}` |

## System

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/health` | — | Liveness |
| GET | `/api/status` | any | Which provider each layer is using |
| GET | `/api/logs` | any | Audit trail. `?limit=&incident_id=&agent=&escalated_only=` |
| GET | `/api/analytics` | any | After-action summary |
| GET/POST | `/api/closures` | any / commander | Road closures; POST replans affected routes |
| DELETE | `/api/closures/{id}` | commander | Clear |
| POST | `/api/route` | any | Route preview `{origin:[lat,lng], destination:[lat,lng]}` |
| POST | `/api/scenario/flood` | commander | Fire the seeded burst |
| POST | `/api/scenario/social-post` | commander | Inject one synthetic report |
| POST | `/api/scenario/reset` | commander | Clear operational data, keep accounts |

## WebSocket

`ws://localhost:8000/ws?token=<jwt>`

Messages are `{topic, ts, data}`.

| Topic | Payload |
|---|---|
| `connected` | Session info plus the last 25 events |
| `incident.created` / `incident.updated` / `incident.resolved` | Incident |
| `report.created` | `{report_id, incident_id}` |
| `resource.updated` | Full resource including route |
| `resource.moved` | Position ping — id, lat, lng, ETA, progress |
| `decision.created` / `decision.resolved` | Dispatch decision |
| `assignment` | Sent only to the assigned responder |
| `log.appended` | Audit entry |
| `alert` | `{level, title, message, incident_id}` |
| `queue.tick` | Cycle summary and top-ranked incidents |
| `closure.updated` | Closure change plus routes replanned |

## Errors

| Code | Meaning |
|---|---|
| 401 | Missing or expired token |
| 403 | Role not permitted |
| 404 | Not found |
| 409 | Conflict — already decided, unit unavailable, unit mid-job |
| 422 | Validation failure |

Errors return `{"detail": "..."}` written for a person to read, e.g.
`"Ambulance 03 is en route and cannot be dispatched."`
