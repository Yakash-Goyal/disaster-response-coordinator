"""Supervisor Agent (Orchestrator) — specification section 4.7.

This is the only component that changes shared state. It:

  * runs the Triage Agent on inbound reports and merges duplicates
  * runs the Dispatch Agent over the unassigned queue, most urgent first
  * detects and resolves conflicts (two incidents wanting the same unit)
  * escalates to the human commander whenever confidence is low, stakes are
    high, or two recommendations disagree
  * writes every agent decision and every human response to an append-only log

Human-in-the-loop is the default and cannot be switched off for severe
incidents: `ALLOW_AUTO_APPROVE` only ever applies at or below
`AUTO_APPROVE_MAX_SEVERITY`, and severity >= `ESCALATE_SEVERITY` always waits
for a commander (NFR "Human override").
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..events import Topic, bus
from ..geo import incident_index, resource_index
from ..models import (
    AgentLog,
    DispatchDecision,
    HumanAction,
    Incident,
    IncidentStatus,
    Report,
    ReportSource,
    Resource,
    ResourceStatus,
    RoadClosure,
    User,
)
from ..services import dedup, queue
from . import dispatch as dispatch_agent
from . import routing
from . import triage as triage_agent

log = logging.getLogger("drc.supervisor")

_cycle_lock = asyncio.Lock()


# --------------------------------------------------------------------------
# Audit trail
# --------------------------------------------------------------------------
def record(
    db: Session,
    agent: str,
    action: str,
    detail: str,
    *,
    payload: dict | None = None,
    incident_id: int | None = None,
    resource_id: int | None = None,
    decision_id: int | None = None,
    actor: str = "agent",
    escalated: bool = False,
    commit: bool = True,
) -> AgentLog:
    entry = AgentLog(
        agent=agent,
        action=action,
        detail=detail,
        payload=payload,
        incident_id=incident_id,
        resource_id=resource_id,
        decision_id=decision_id,
        actor=actor,
        escalated=escalated,
    )
    db.add(entry)
    if commit:
        db.commit()
    bus.publish_soon(
        Topic.LOG_APPENDED,
        {
            "id": entry.id,
            "agent": agent,
            "action": action,
            "detail": detail,
            "incident_id": incident_id,
            "resource_id": resource_id,
            "decision_id": decision_id,
            "actor": actor,
            "escalated": escalated,
            "created_at": (entry.created_at or datetime.now(timezone.utc)).isoformat(),
        },
    )
    return entry


def active_closures(db: Session) -> list[dict]:
    rows = db.scalars(select(RoadClosure).where(RoadClosure.active.is_(True))).all()
    return [{"id": c.id, "lat": c.lat, "lng": c.lng, "radius_m": c.radius_m, "note": c.note} for c in rows]


# --------------------------------------------------------------------------
# Serialisation helpers (kept here so every broadcast has one shape)
# --------------------------------------------------------------------------
def incident_payload(incident: Incident) -> dict:
    return {
        "id": incident.id,
        "type": incident.type,
        "severity": incident.severity,
        "urgency_score": incident.urgency_score,
        "status": incident.status,
        "summary": incident.summary,
        "lat": incident.lat,
        "lng": incident.lng,
        "address": incident.address,
        "report_count": incident.report_count,
        "triage_confidence": incident.triage_confidence,
        "needs_review": incident.needs_review,
        "triage_source": incident.triage_source,
        "required_capabilities": list(incident.required_capabilities or []),
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
        "updated_at": incident.updated_at.isoformat() if incident.updated_at else None,
    }


def resource_payload(resource: Resource) -> dict:
    return {
        "id": resource.id,
        "name": resource.name,
        "type": resource.type,
        "status": resource.status,
        "lat": resource.lat,
        "lng": resource.lng,
        "capabilities": list(resource.capabilities or []),
        "incident_id": resource.incident_id,
        "route": resource.route,
        "route_stops": resource.route_stops,
        "route_progress_m": resource.route_progress_m,
        "route_length_m": resource.route_length_m,
        "eta_seconds": resource.eta_seconds,
        "missions_completed": resource.missions_completed,
    }


def decision_payload(decision: DispatchDecision) -> dict:
    return {
        "id": decision.id,
        "incident_id": decision.incident_id,
        "resource_id": decision.resource_id,
        "agent_recommendation": decision.agent_recommendation,
        "alternatives": decision.alternatives,
        "rationale": decision.rationale,
        "confidence": decision.confidence,
        "eta_seconds": decision.eta_seconds,
        "distance_m": decision.distance_m,
        "escalated": decision.escalated,
        "escalation_reason": decision.escalation_reason,
        "human_action": decision.human_action,
        "human_note": decision.human_note,
        "final_resource_id": decision.final_resource_id,
        "created_at": decision.created_at.isoformat() if decision.created_at else None,
        "decided_at": decision.decided_at.isoformat() if decision.decided_at else None,
    }


# --------------------------------------------------------------------------
# Intake pipeline
# --------------------------------------------------------------------------
async def handle_report(
    db: Session,
    *,
    text: str,
    lat: float,
    lng: float,
    source: str = ReportSource.MANUAL.value,
    address: str | None = None,
    reporter: str | None = None,
    image_url: str | None = None,
) -> tuple[Report, Incident, bool, triage_agent.TriageResult]:
    """Ingest one report: classify it, fold it into an existing incident if it
    describes the same event, otherwise open a new one."""
    report = Report(
        source=source,
        text=text,
        lat=lat,
        lng=lng,
        address=address,
        reporter=reporter,
        image_url=image_url,
    )
    db.add(report)
    db.flush()

    # Provisional classification drives the duplicate search.
    provisional = triage_agent.heuristic_triage(text)
    existing, match_score = dedup.find_duplicate(db, lat, lng, text, provisional.type)

    if existing is not None:
        existing.report_count = (existing.report_count or 1) + 1
        report.incident_id = existing.id
        # Re-triage with corroboration count; more reports can raise severity.
        result = await triage_agent.triage_report(
            text, report_count=existing.report_count, address=address
        )
        if result.severity > existing.severity:
            existing.severity = result.severity
        existing.required_capabilities = sorted(
            set(existing.required_capabilities or []) | set(result.required_capabilities)
        )
        existing.updated_at = datetime.now(timezone.utc)
        existing.urgency_score = queue.compute_urgency(existing)
        db.commit()

        incident_index.upsert(existing.id, existing.lat, existing.lng)
        record(
            db,
            "triage",
            "report_merged",
            f"Report #{report.id} merged into incident #{existing.id} "
            f"(match {match_score}); now {existing.report_count} corroborating reports.",
            payload={"match_score": match_score, "triage": result.as_dict()},
            incident_id=existing.id,
        )
        await bus.publish(Topic.REPORT_CREATED, {"report_id": report.id, "incident_id": existing.id})
        await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(existing))
        return report, existing, True, result

    result = await triage_agent.triage_report(text, report_count=1, address=address)
    incident = Incident(
        type=result.type,
        severity=result.severity,
        status=IncidentStatus.PENDING.value,
        summary=result.summary,
        lat=lat,
        lng=lng,
        address=address,
        report_count=1,
        triage_confidence=result.confidence,
        needs_review=result.needs_review,
        triage_source=result.source,
        required_capabilities=result.required_capabilities,
    )
    db.add(incident)
    db.flush()
    report.incident_id = incident.id
    incident.urgency_score = queue.compute_urgency(incident)
    db.commit()

    incident_index.upsert(incident.id, incident.lat, incident.lng)
    record(
        db,
        "triage",
        "incident_created",
        f"Classified as {result.type} severity {result.severity} "
        f"(confidence {result.confidence:.2f}, {result.source}). {result.reasoning}",
        payload=result.as_dict(),
        incident_id=incident.id,
        escalated=result.needs_review,
    )
    if result.needs_review:
        record(
            db,
            "supervisor",
            "escalation",
            f"Triage confidence {result.confidence:.2f} is below the "
            f"{settings.TRIAGE_REVIEW_THRESHOLD:.2f} threshold — incident #{incident.id} "
            "needs a commander to confirm the classification.",
            incident_id=incident.id,
            escalated=True,
        )

    await bus.publish(Topic.REPORT_CREATED, {"report_id": report.id, "incident_id": incident.id})
    await bus.publish(Topic.INCIDENT_CREATED, incident_payload(incident))
    if incident.severity >= settings.ESCALATE_SEVERITY:
        await bus.publish(
            Topic.ALERT,
            {
                "level": "critical" if incident.severity >= 5 else "high",
                "title": f"Severity {incident.severity} {incident.type.replace('_', ' ')}",
                "message": incident.summary,
                "incident_id": incident.id,
            },
            roles={"commander", "admin"},
        )
    return report, incident, False, result


# --------------------------------------------------------------------------
# Dispatch cycle
# --------------------------------------------------------------------------
def _pending_decision(db: Session, incident_id: int) -> DispatchDecision | None:
    return db.scalars(
        select(DispatchDecision)
        .where(
            DispatchDecision.incident_id == incident_id,
            DispatchDecision.human_action == HumanAction.PENDING.value,
        )
        .order_by(DispatchDecision.created_at.desc())
    ).first()


def _rejected_units(db: Session, incident_id: int) -> set[int]:
    """Units a commander has already turned down for this incident. Without
    this, a rejected incident goes back to pending and the next cycle simply
    recommends the same unit again."""
    return set(
        db.scalars(
            select(DispatchDecision.resource_id).where(
                DispatchDecision.incident_id == incident_id,
                DispatchDecision.human_action == HumanAction.REJECTED.value,
                DispatchDecision.resource_id.is_not(None),
            )
        ).all()
    )


# Incidents already told "no unit available", with the reason given. The
# cycle runs every few seconds; repeating the same alert each time would bury
# the log and the commander's screen.
_no_candidate_reported: dict[int, str] = {}


def forget_incidents() -> None:
    """Drop per-incident memory after a scenario reset."""
    _no_candidate_reported.clear()


def _escalation_reason(incident: Incident, rec: dispatch_agent.Recommendation) -> str | None:
    if incident.severity >= settings.ESCALATE_SEVERITY:
        return f"Severity {incident.severity} incidents always require commander approval."
    if rec.confidence < 0.6:
        return f"Dispatch confidence {rec.confidence:.2f} is low — the top two options are close."
    if incident.needs_review:
        return "Triage flagged this incident for human review."
    if rec.best and rec.best.notes:
        missing = [n for n in rec.best.notes if n.startswith("missing")]
        if missing:
            return f"Recommended unit is {missing[0]}."
    return None


async def run_dispatch_cycle(db: Session, *, limit: int = 6) -> list[DispatchDecision]:
    """Produce recommendations for the most urgent unassigned incidents.

    Conflict resolution: recommendations are generated in urgency order and a
    unit already claimed by a higher-urgency incident in this same cycle is
    removed from consideration, then that incident is re-evaluated against the
    remaining pool. The conflict and its resolution are both logged.
    """
    if _cycle_lock.locked():
        return []

    async with _cycle_lock:
        queue.refresh_queue(db)
        pending = queue.unassigned(db)[:limit]
        if not pending:
            return []

        closures = active_closures(db)
        claimed: dict[int, int] = {}  # resource_id -> incident_id
        created: list[DispatchDecision] = []

        for incident in pending:
            if _pending_decision(db, incident.id) is not None:
                continue

            rec = await dispatch_agent.recommend(
                db, incident, closures, exclude=_rejected_units(db, incident.id)
            )

            if rec.has_recommendation and rec.best.resource.id in claimed:
                holder = claimed[rec.best.resource.id]
                record(
                    db,
                    "supervisor",
                    "conflict_detected",
                    f"{rec.best.resource.name} was already recommended for incident "
                    f"#{holder}, which outranks incident #{incident.id}. "
                    "Re-evaluating with that unit removed.",
                    payload={"resource_id": rec.best.resource.id, "held_by_incident": holder},
                    incident_id=incident.id,
                    escalated=True,
                )
                remaining = [c for c in rec.alternatives if c.resource.id not in claimed]
                if remaining:
                    best, alternatives = remaining[0], remaining[1:]
                    rec = dispatch_agent.Recommendation(
                        incident_id=incident.id,
                        best=best,
                        alternatives=alternatives,
                        rationale=dispatch_agent.template_rationale(incident, best, alternatives)
                        + f" Reassigned after {claimed and 'a higher-priority incident claimed the first choice' or 'a conflict'}.",
                        confidence=max(rec.confidence - 0.12, 0.05),
                        rationale_source="template",
                    )
                else:
                    rec = dispatch_agent.Recommendation(
                        incident_id=incident.id,
                        best=None,
                        alternatives=[],
                        rationale="",
                        confidence=0.0,
                        reason_no_candidate=(
                            "Every suitable unit is already committed to a higher-priority "
                            "incident this cycle. Free a unit or lower another incident's priority."
                        ),
                    )

            if not rec.has_recommendation:
                reason = rec.reason_no_candidate or "No suitable unit found."
                if _no_candidate_reported.get(incident.id) == reason:
                    continue
                _no_candidate_reported[incident.id] = reason
                record(
                    db,
                    "dispatch",
                    "no_candidate",
                    rec.reason_no_candidate or "No suitable unit found.",
                    incident_id=incident.id,
                    escalated=True,
                )
                await bus.publish(
                    Topic.ALERT,
                    {
                        "level": "warning",
                        "title": f"No unit available for incident #{incident.id}",
                        "message": rec.reason_no_candidate,
                        "incident_id": incident.id,
                    },
                    roles={"commander", "admin"},
                )
                continue

            reason = _escalation_reason(incident, rec)
            auto_ok = (
                settings.ALLOW_AUTO_APPROVE
                and reason is None
                and incident.severity <= settings.AUTO_APPROVE_MAX_SEVERITY
                and rec.confidence >= 0.75
            )

            decision = DispatchDecision(
                incident_id=incident.id,
                resource_id=rec.best.resource.id,
                agent_recommendation=rec.best.to_payload(),
                alternatives=[c.to_payload() for c in rec.alternatives],
                rationale=rec.rationale,
                confidence=rec.confidence,
                eta_seconds=rec.best.eta_seconds,
                distance_m=rec.best.road_distance_m,
                escalated=not auto_ok,
                escalation_reason=reason
                or ("Awaiting commander approval." if not auto_ok else None),
            )
            db.add(decision)
            db.flush()

            incident.status = IncidentStatus.AWAITING_APPROVAL.value
            claimed[rec.best.resource.id] = incident.id
            _no_candidate_reported.pop(incident.id, None)
            db.commit()

            record(
                db,
                "dispatch",
                "recommendation",
                rec.rationale,
                payload={
                    "confidence": rec.confidence,
                    "rationale_source": rec.rationale_source,
                    "recommended": rec.best.to_payload(),
                    "alternatives": [c.to_payload() for c in rec.alternatives],
                },
                incident_id=incident.id,
                resource_id=rec.best.resource.id,
                decision_id=decision.id,
                escalated=not auto_ok,
            )

            await bus.publish(Topic.DECISION_CREATED, decision_payload(decision))
            await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
            created.append(decision)

            if auto_ok:
                record(
                    db,
                    "supervisor",
                    "auto_approved",
                    f"Severity {incident.severity} is at or below the auto-approve ceiling "
                    f"and confidence is {rec.confidence:.2f}; dispatching without waiting.",
                    incident_id=incident.id,
                    decision_id=decision.id,
                )
                await apply_decision(db, decision, action="accept", actor=None, note="auto-approved")

        return created


# --------------------------------------------------------------------------
# Human decisions
# --------------------------------------------------------------------------
async def assign_resource(
    db: Session, incident: Incident, resource: Resource, *, decision: DispatchDecision | None = None
) -> routing.Route:
    """Commit an assignment: route the unit, flip statuses, notify everyone."""
    closures = active_closures(db)
    route = await routing.get_route(
        (resource.lat, resource.lng),
        (incident.lat, incident.lng),
        speed_kmh=resource.speed_kmh or 40.0,
        closures=closures,
    )

    resource.incident_id = incident.id
    resource.status = ResourceStatus.EN_ROUTE.value
    resource.route = route.geometry
    resource.route_stops = [
        {
            "order": 1,
            "label": f"Incident #{incident.id}",
            "incident_id": incident.id,
            "lat": incident.lat,
            "lng": incident.lng,
            "eta_seconds": round(route.duration_s, 1),
        }
    ]
    resource.route_progress_m = 0.0
    resource.route_length_m = route.distance_m
    resource.eta_seconds = route.duration_s

    incident.status = IncidentStatus.EN_ROUTE.value
    if incident.first_dispatch_at is None:
        incident.first_dispatch_at = datetime.now(timezone.utc)
    incident.urgency_score = queue.compute_urgency(incident)
    db.commit()

    resource_index.upsert(resource.id, resource.lat, resource.lng)

    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
    await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
    await bus.publish(
        Topic.ASSIGNMENT,
        {
            "resource": resource_payload(resource),
            "incident": incident_payload(incident),
            "route": route.as_dict(),
            "instructions": f"Proceed to {incident.address or 'the marked location'}. "
            f"{incident.type.replace('_', ' ').title()}, severity {incident.severity}.",
        },
        resource_id=resource.id,
    )
    return route


async def apply_decision(
    db: Session,
    decision: DispatchDecision,
    *,
    action: str,
    actor: User | None,
    resource_id: int | None = None,
    note: str | None = None,
) -> DispatchDecision:
    """Record a commander's response to an agent recommendation and act on it."""
    if decision.human_action != HumanAction.PENDING.value:
        raise ValueError("That recommendation has already been decided.")

    incident = db.get(Incident, decision.incident_id)
    if incident is None:
        raise ValueError("The incident this recommendation refers to no longer exists.")

    actor_name = actor.username if actor else "system"
    decision.acted_by_id = actor.id if actor else None
    decision.human_note = note
    decision.decided_at = datetime.now(timezone.utc)

    if action == "reject":
        decision.human_action = HumanAction.REJECTED.value
        incident.status = IncidentStatus.PENDING.value
        incident.urgency_score = queue.compute_urgency(incident)
        db.commit()
        rejected_unit = db.get(Resource, decision.resource_id) if decision.resource_id else None
        record(
            db,
            "human",
            "decision_rejected",
            f"{actor_name} rejected the recommendation for incident #{incident.id}."
            + (f" {rejected_unit.name} will not be suggested for it again." if rejected_unit else "")
            + (f" Note: {note}" if note else ""),
            incident_id=incident.id,
            decision_id=decision.id,
            actor=actor_name,
        )
        await bus.publish(Topic.DECISION_RESOLVED, decision_payload(decision))
        await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
        return decision

    if action == "override":
        if resource_id is None:
            raise ValueError("Overriding requires the unit you want to send instead.")
        chosen = db.get(Resource, resource_id)
        if chosen is None:
            raise ValueError("That unit does not exist.")
        if chosen.status != ResourceStatus.AVAILABLE.value:
            raise ValueError(f"{chosen.name} is {chosen.status.replace('_', ' ')} and cannot be dispatched.")
        decision.human_action = HumanAction.OVERRIDDEN.value
    else:
        chosen = db.get(Resource, decision.resource_id) if decision.resource_id else None
        if chosen is None:
            raise ValueError("The recommended unit is no longer available.")
        if chosen.status != ResourceStatus.AVAILABLE.value:
            raise ValueError(f"{chosen.name} is {chosen.status.replace('_', ' ')} and cannot be dispatched.")
        decision.human_action = HumanAction.ACCEPTED.value

    decision.final_resource_id = chosen.id
    db.commit()

    route = await assign_resource(db, incident, chosen, decision=decision)

    verb = "accepted" if decision.human_action == HumanAction.ACCEPTED.value else "overrode"
    detail = (
        f"{actor_name} {verb} the recommendation for incident #{incident.id}: "
        f"{chosen.name} dispatched, ETA {route.duration_s/60:.0f} min."
    )
    if decision.human_action == HumanAction.OVERRIDDEN.value and decision.resource_id:
        original = db.get(Resource, decision.resource_id)
        if original:
            detail += f" Agent had recommended {original.name}."
    if note:
        detail += f" Note: {note}"

    record(
        db,
        "human",
        f"decision_{decision.human_action}",
        detail,
        payload={"eta_seconds": route.duration_s, "distance_m": route.distance_m},
        incident_id=incident.id,
        resource_id=chosen.id,
        decision_id=decision.id,
        actor=actor_name,
    )
    await bus.publish(Topic.DECISION_RESOLVED, decision_payload(decision))
    return decision


# --------------------------------------------------------------------------
# Pre-emption: a critical incident can pull a unit off a lesser job
# --------------------------------------------------------------------------
async def preempt(db: Session, incident: Incident, resource: Resource, actor: User | None = None) -> None:
    """Redirect an en-route unit to a higher-priority incident (section 4.6)."""
    previous = db.get(Incident, resource.incident_id) if resource.incident_id else None
    if previous is not None and previous.id != incident.id:
        previous.status = IncidentStatus.PENDING.value
        previous.urgency_score = queue.compute_urgency(previous)
        for pending in db.scalars(
            select(DispatchDecision).where(
                DispatchDecision.incident_id == previous.id,
                DispatchDecision.human_action == HumanAction.PENDING.value,
            )
        ).all():
            pending.human_action = HumanAction.SUPERSEDED.value
            pending.decided_at = datetime.now(timezone.utc)
        db.commit()
        record(
            db,
            "supervisor",
            "preempted",
            f"{resource.name} pulled off incident #{previous.id} for higher-priority "
            f"incident #{incident.id}. Incident #{previous.id} is back in the queue.",
            incident_id=previous.id,
            resource_id=resource.id,
            actor=actor.username if actor else "agent",
            escalated=True,
        )
        await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(previous))

    resource.status = ResourceStatus.AVAILABLE.value
    resource.incident_id = None
    db.commit()
    await assign_resource(db, incident, resource)


# --------------------------------------------------------------------------
# Re-routing after a closure is reported
# --------------------------------------------------------------------------
async def reroute_affected(db: Session, closure: RoadClosure) -> int:
    """Re-plan every in-flight route that passes through a new closure."""
    closures = active_closures(db)
    moving = db.scalars(
        select(Resource).where(Resource.status == ResourceStatus.EN_ROUTE.value)
    ).all()
    rerouted = 0

    for resource in moving:
        if not resource.route or not resource.incident_id:
            continue
        current = routing.Route(
            geometry=resource.route, distance_m=resource.route_length_m, duration_s=0.0, provider="cached"
        )
        if routing.route_is_blocked(current, [{"lat": closure.lat, "lng": closure.lng, "radius_m": closure.radius_m}]) is None:
            continue

        incident = db.get(Incident, resource.incident_id)
        if incident is None:
            continue
        route = await routing.get_route(
            (resource.lat, resource.lng),
            (incident.lat, incident.lng),
            speed_kmh=resource.speed_kmh or 40.0,
            closures=closures,
        )
        resource.route = route.geometry
        resource.route_progress_m = 0.0
        resource.route_length_m = route.distance_m
        resource.eta_seconds = route.duration_s
        rerouted += 1
        db.commit()

        record(
            db,
            "routing",
            "rerouted",
            f"{resource.name} re-routed around a closure at "
            f"{closure.lat:.4f}, {closure.lng:.4f}. New ETA {route.duration_s/60:.0f} min.",
            payload={"closure_id": closure.id, "distance_m": route.distance_m},
            incident_id=incident.id,
            resource_id=resource.id,
        )
        await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
        await bus.publish(
            Topic.ASSIGNMENT,
            {
                "resource": resource_payload(resource),
                "incident": incident_payload(incident),
                "route": route.as_dict(),
                "instructions": "Route updated — a road on your path is blocked.",
            },
            resource_id=resource.id,
        )

    return rerouted
