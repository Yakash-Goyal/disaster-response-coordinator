"""Analytics / After-Action View — specification section 4.12.

Two audiences. Operationally this answers "how fast are we actually
responding?". For the project report it answers "was the agent any good?" —
the acceptance rate is the honest measure: how often did a commander take the
agent's recommendation without changing it.

Acceptance rate deliberately counts only decisions a human actually ruled on.
Auto-approved and superseded decisions are excluded, because counting them
would let the system flatter itself.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from statistics import median

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    DispatchDecision,
    HumanAction,
    Incident,
    IncidentStatus,
    Report,
    Resource,
    ResourceStatus,
)


def _seconds_between(start, end) -> float | None:
    if start is None or end is None:
        return None
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    delta = (end - start).total_seconds()
    return round(delta, 1) if delta >= 0 else None


def _median(values: list[float]) -> float | None:
    clean = [v for v in values if v is not None]
    return round(median(clean), 1) if clean else None


def build_summary(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    incidents = db.scalars(select(Incident)).all()
    reports_total = db.scalar(select(func.count(Report.id))) or 0
    decisions = db.scalars(select(DispatchDecision)).all()
    resources = db.scalars(select(Resource)).all()

    closed_states = {IncidentStatus.RESOLVED.value, IncidentStatus.DISMISSED.value}
    open_incidents = [i for i in incidents if i.status not in closed_states]
    resolved = [i for i in incidents if i.status == IncidentStatus.RESOLVED.value]

    timings = []
    to_dispatch, to_scene, to_resolve = [], [], []
    for incident in incidents:
        d = _seconds_between(incident.created_at, incident.first_dispatch_at)
        s = _seconds_between(incident.created_at, incident.on_scene_at)
        r = _seconds_between(incident.created_at, incident.resolved_at)
        if d is not None:
            to_dispatch.append(d)
        if s is not None:
            to_scene.append(s)
        if r is not None:
            to_resolve.append(r)
        if any(v is not None for v in (d, s, r)):
            timings.append(
                {
                    "incident_id": incident.id,
                    "type": incident.type,
                    "severity": incident.severity,
                    "seconds_to_dispatch": d,
                    "seconds_to_on_scene": s,
                    "seconds_to_resolve": r,
                }
            )

    action_counts = Counter(d.human_action for d in decisions)
    accepted = action_counts.get(HumanAction.ACCEPTED.value, 0)
    overridden = action_counts.get(HumanAction.OVERRIDDEN.value, 0)
    rejected = action_counts.get(HumanAction.REJECTED.value, 0)
    pending = action_counts.get(HumanAction.PENDING.value, 0)

    judged = accepted + overridden + rejected
    acceptance = round(accepted / judged, 4) if judged else None

    # Utilisation: share of elapsed mission time each unit spent committed.
    utilisation = []
    for resource in sorted(resources, key=lambda r: r.name):
        if resource.type == "shelter" or resource.status == ResourceStatus.RETIRED.value:
            continue
        earliest = min((i.created_at for i in incidents), default=None)
        window = _seconds_between(earliest, now) or 1.0
        utilisation.append(
            {
                "resource_id": resource.id,
                "name": resource.name,
                "type": resource.type,
                "status": resource.status,
                "missions_completed": resource.missions_completed,
                "busy_seconds": round(resource.busy_seconds, 1),
                "utilisation": round(min(resource.busy_seconds / window, 1.0), 4),
                "currently_committed": resource.status != ResourceStatus.AVAILABLE.value,
            }
        )

    dedup_ratio = round(1 - (len(incidents) / reports_total), 4) if reports_total else 0.0

    return {
        "generated_at": now,
        "incidents_total": len(incidents),
        "incidents_open": len(open_incidents),
        "incidents_resolved": len(resolved),
        "reports_total": reports_total,
        "dedup_ratio": max(dedup_ratio, 0.0),
        "median_seconds_to_dispatch": _median(to_dispatch),
        "median_seconds_to_on_scene": _median(to_scene),
        "median_seconds_to_resolve": _median(to_resolve),
        "agent_acceptance_rate": acceptance,
        "decisions_total": len(decisions),
        "decisions_accepted": accepted,
        "decisions_overridden": overridden,
        "decisions_rejected": rejected,
        "decisions_pending": pending,
        "resource_utilisation": utilisation,
        "incidents_by_type": dict(Counter(i.type for i in incidents)),
        "incidents_by_severity": {str(k): v for k, v in sorted(Counter(i.severity for i in incidents).items())},
        "timings": sorted(timings, key=lambda t: t["incident_id"]),
    }
