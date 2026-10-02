# Demo script

About eight minutes. Two browser windows: the commander dashboard, and a narrow
window signed in as `responder1`.

Before starting, press **Reset** on the dashboard so timings begin clean.

---

## 1. The problem (30 s)

Sign in as `commander`. The queue is already full — fifteen reports have arrived
from citizens, social media and a hazard feed.

> "This is the first ninety seconds of a flood. No human reads fifteen reports
> and ranks them correctly while more keep arriving."

Point at the queue. Note the **urgency spine** on each row: its fill height is
the incident's live urgency score.

## 2. Triage (60 s)

Open the **File report** tab and submit:

> `Elderly man collapsed at the relief queue, unconscious and not responding`

The panel shows the classification and confidence. Then submit a hedged one:

> `not sure what i saw near the fuel station, maybe smoke maybe just haze`

It comes back with low confidence and a **REVIEW** flag.

> "The agent doesn't guess when the reporter isn't sure. Hedging language lowers
> confidence, and anything under the threshold goes to a human."

Now file a near-duplicate of an existing incident:

> `market road is completely flooded, cars are stuck`

The response says **merged** — the report count rises instead of a competing
incident opening.

> "Ten callers reporting one collapsed building shouldn't summon ten ambulances."

## 3. Dispatch with a human in the loop (90 s)

Click a row marked **AWAITING YOU**. The decision panel shows the recommended
unit, its ETA and distance, the plain-language rationale, and the alternatives
that were considered.

> "It didn't just pick the nearest. It shortlisted by capability, then got real
> routed ETAs for the top three before ranking. And it can't dispatch — it can
> only recommend."

Press **Approve**. The unit starts moving on the map immediately.

Now pick a second pending decision and press **Override**, choosing a different
unit from the list.

> "Every override is recorded. That disagreement rate is our evaluation metric —
> it tells us how good the agent actually is."

## 4. Live field view (60 s)

Switch to the responder window. The same job appears: assignment, route, ETA
counting down. Press **On scene**.

Switch back to the dashboard — the status has already changed and the log has
the entry.

## 5. Re-routing (60 s)

On the dashboard press **Block a road**, then click directly on an active route
line on the map.

The log records the closure and the re-route; the affected unit's ETA changes
and its path bends around the blockage.

> "A blocked bridge is the case where nearest-by-straight-line is exactly wrong."

## 6. Conflict resolution (45 s)

Press **Inject report** three or four times quickly near existing incidents, then
**Run agents**.

Scroll the log for a `conflict_detected` entry.

> "Two incidents wanted the same unit. Because recommendations are generated
> before any of them commit, the supervisor sees the clash, gives the unit to the
> more urgent incident, and re-evaluates the other."

## 7. After action (60 s)

Open the **After action** tab.

> "Median time from report to unit committed. Median to on scene. Dedup ratio —
> how many reports collapsed into how many incidents. And the acceptance rate:
> how often the commander took the recommendation unchanged. It counts only
> decisions a human actually ruled on, so auto-approvals can't inflate it."

## 8. Close (30 s)

Point at the status bar.

> "Agents, routing, database — each of those is running on a local fallback right
> now. Set an API key and it uses a language model; set an OSRM URL and it uses
> real road networks; point it at Postgres and geospatial queries move to PostGIS.
> Nothing about the system stops working when a dependency is unavailable, which
> for a disaster response tool is the point."

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| Queue empty | Press **Reset**, then `POST /api/scenario/flood` or Reset again |
| Nothing moving | Check `SIM_ENABLED`; raise `SIM_SPEED_MULTIPLIER` for a faster demo |
| No pending decisions | Press **Run agents** |
| Map tiles blank | CARTO tiles need internet; everything else works offline |
| "Reconnecting" in the status bar | The socket retries automatically; REST still works |
