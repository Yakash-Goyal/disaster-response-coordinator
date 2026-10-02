# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  Clients                                                          │
│  Command dashboard (React + Leaflet)   Responder view (mobile)    │
└───────────────┬──────────────────────────────┬───────────────────┘
        REST (CRUD)                   WebSocket (live state)
┌───────────────▼──────────────────────────────▼───────────────────┐
│  FastAPI  ·  JWT auth, role-based access                          │
│  routers/  auth · incidents · resources · dispatch · responder    │
└───────────────┬──────────────────────────────────────────────────┘
┌───────────────▼──────────────────────────────────────────────────┐
│  Supervisor Agent (orchestrator)                                  │
│  the only component that mutates shared state                     │
│    ├── Triage Agent      classify, score, flag for review         │
│    ├── Dispatch Agent    shortlist, rank, explain                 │
│    └── Routing Agent     ETAs, detours, multi-stop                │
└───────────────┬──────────────────────────────────────────────────┘
┌───────────────▼──────────────────────────────────────────────────┐
│  Services   ingestion · dedup · queue · simulation · analytics    │
│  Storage    SQLAlchemy ORM  ·  spatial index (grid or PostGIS)    │
└──────────────────────────────────────────────────────────────────┘
```

## Why the Supervisor owns all writes

Triage, Dispatch and Routing are pure: they take state and return a
recommendation. Only the Supervisor commits anything. Three consequences follow,
and they are the reason the design is worth the indirection:

1. **The audit log cannot have holes.** Every mutation passes one function, so
   logging is structural rather than something each call site remembers to do.
2. **Conflicts are resolvable.** Because recommendations are produced before any
   of them are committed, the Supervisor can see that two incidents want the same
   unit and settle it, rather than discovering a double-booking afterwards.
3. **The agents are testable without a database.** `recommend()` returns an
   object; the tests assert on it directly.

## Concurrency model

Three asyncio loops run alongside the request handlers:

| Loop | Period | Job |
|---|---|---|
| Orchestrator | 4 s | recompute urgency, produce recommendations |
| Simulation | 1 s | advance vehicles, publish positions, handle arrivals |
| Ingestion | 25 s / 120 s | social feed, weather feed |

The dispatch cycle runs on a timer rather than firing on every inbound report.
During a burst, twenty reports arrive in five seconds; per-report triggering
would start twenty overlapping cycles competing for the same units. A single
lock (`_cycle_lock`) additionally guarantees only one cycle runs at a time.

## Data model

```
Report  ──many-to-one──▶  Incident  ◀──one-to-many──  DispatchDecision
                             │                              │
                             └──one-to-many──▶ Resource ◀────┘
                                                  │
                                                User (responder)

AgentLog ── append-only, references incident / resource / decision
RoadClosure ── active blockages that force detours
```

`DispatchDecision` is the centrepiece: it stores what the agent recommended,
what it considered instead, why, and what the human then did. That single row is
both the human-in-the-loop mechanism and the evaluation dataset the after-action
view reads.

## Urgency scoring

```
urgency = severity_weight            8 … 74 by severity
        + type_weight                medical/collapse rank above power cuts
        + corroboration_bonus        9·log₃(reports), capped at 14
        + age_bonus                  0.55/min while unaddressed, capped at 25
        − progress_discount          0 pending … 22 on scene
```

Two decisions worth defending:

**Corroboration is logarithmic.** Ten callers means the event is real, not that
it is ten times worse. Linear scaling would let a viral social post outrank a
confirmed casualty.

**Ageing only accrues while nobody is on it.** Otherwise every incident climbs
forever and the ranking stops meaning anything. Once a crew is on scene the
discount pulls it down, freeing attention for what is still unanswered.

## Geospatial strategy

The specification calls for proper indexing rather than naive distance loops.

**SQLite (default)** — a uniform grid hash. Points are bucketed into ~0.01°
cells, with longitude cells widened by 1/cos(latitude) so cells stay roughly
square in metres. A radius query computes the cell window the circle spans and
reads only those buckets; haversine refinement then runs over that small
candidate set. `query_knn` expands the ring outward until it has enough
candidates, so sparse areas do not force a full-extent scan.

**PostgreSQL** — a generated `geography(Point,4326)` column plus a GiST index;
queries become `ST_DWithin` + `ST_Distance`.

Both are behind `find_nearby()`, so the Dispatch Agent never knows which is
active. `tests/test_geo.py` asserts the grid index returns exactly the same set
a brute-force scan would over 600 random points.

## Agent fallbacks

Both the LLM and routing layers use the same pattern: try the real provider,
fall back to a deterministic implementation, and label the result.

- **Circuit breaker.** After three consecutive failures the provider is disabled
  rather than retried on every incident.
- **Cross-checking.** When the LLM returns a type the keyword model strongly
  disagrees with, confidence is reduced and the incident is flagged for review.
  Disagreement between two methods is information, not an error.
- **Labelled output.** The rationale says when an ETA came from the estimator.
  A commander should never mistake a demo number for a surveyed one.

## Real-time transport

One `EventBus` owns every socket. Events are typed (`incident.created`,
`resource.moved`, `decision.created`, …) and can be scoped by role or targeted at
a single responder's device. Dead sockets are dropped during broadcast rather
than allowed to stall the orchestrator. The client reconnects with exponential
backoff capped at 15 s, and reconciles by re-fetching on `queue.tick`.

## Known limitations

- The offline route estimator produces plausible geometry, not real streets.
  Point `OSRM_URL` at a routing service for true road networks.
- Heuristic triage is a weighted keyword and phrase model. It handles the
  scenario vocabulary well and is measurably calibrated on hedged reports, but
  it is not a substitute for a language model on genuinely novel phrasing.
- The simulation advances vehicles along their assigned polyline at constant
  speed. There is no traffic model.
- Geocoding is not implemented; reports carry coordinates, and the address field
  is free text.
