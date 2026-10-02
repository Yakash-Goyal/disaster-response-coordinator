"""Dispatch decision endpoints — the human-in-the-loop surface (spec 4.5, 4.7)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents import dispatch as dispatch_agent
from ..agents import supervisor
from ..database import get_db
from ..events import Topic, bus
from ..models import DispatchDecision, HumanAction, Incident, Resource, User
from ..schemas import DecisionAction, DecisionOut, DispatchRequest, ResourceOut
from ..security import current_user, require_commander

router = APIRouter(prefix="/api/dispatch", tags=["dispatch"])


@router.get("/decisions", response_model=list[DecisionOut])
def list_decisions(
    pending_only: bool = False,
    incident_id: int | None = None,
    limit: int = Query(100, le=400),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    stmt = select(DispatchDecision).order_by(DispatchDecision.created_at.desc()).limit(limit)
    if pending_only:
        stmt = stmt.where(DispatchDecision.human_action == HumanAction.PENDING.value)
    if incident_id is not None:
        stmt = stmt.where(DispatchDecision.incident_id == incident_id)
    return [DecisionOut.model_validate(d) for d in db.scalars(stmt).all()]


@router.get("/decisions/{decision_id}", response_model=DecisionOut)
def get_decision(decision_id: int, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    decision = db.get(DispatchDecision, decision_id)
    if decision is None:
        raise HTTPException(404, "No decision with that id.")
    return DecisionOut.model_validate(decision)


@router.post("/decisions/{decision_id}/action", response_model=DecisionOut)
async def act_on_decision(
    decision_id: int,
    payload: DecisionAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Accept, override, or reject an agent recommendation.

    This is the only path that puts a vehicle on the road.
    """
    decision = db.get(DispatchDecision, decision_id)
    if decision is None:
        raise HTTPException(404, "No decision with that id.")

    try:
        updated = await supervisor.apply_decision(
            db,
            decision,
            action=payload.action,
            actor=user,
            resource_id=payload.resource_id,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return DecisionOut.model_validate(updated)


@router.post("/run", response_model=list[DecisionOut])
async def run_cycle(
    db: Session = Depends(get_db),
    _user: User = Depends(require_commander),
):
    """Ask the Supervisor for recommendations right now instead of waiting for
    the next orchestrator tick."""
    decisions = await supervisor.run_dispatch_cycle(db)
    return [DecisionOut.model_validate(d) for d in decisions]


@router.post("/recommend", response_model=DecisionOut)
async def recommend_for_incident(
    payload: DispatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Force a fresh recommendation for one incident, superseding any pending one."""
    incident = db.get(Incident, payload.incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")

    existing = db.scalars(
        select(DispatchDecision).where(
            DispatchDecision.incident_id == incident.id,
            DispatchDecision.human_action == HumanAction.PENDING.value,
        )
    ).all()
    if existing and not payload.force:
        raise HTTPException(
            409,
            "A recommendation for this incident is already waiting on you. "
            "Send force=true to replace it.",
        )
    for old in existing:
        old.human_action = HumanAction.SUPERSEDED.value
    db.commit()

    rec = await dispatch_agent.recommend(db, incident, supervisor.active_closures(db))
    if not rec.has_recommendation:
        raise HTTPException(409, rec.reason_no_candidate or "No suitable unit is available.")

    decision = DispatchDecision(
        incident_id=incident.id,
        resource_id=rec.best.resource.id,
        agent_recommendation=rec.best.to_payload(),
        alternatives=[c.to_payload() for c in rec.alternatives],
        rationale=rec.rationale,
        confidence=rec.confidence,
        eta_seconds=rec.best.eta_seconds,
        distance_m=rec.best.road_distance_m,
        escalated=True,
        escalation_reason=f"Requested by {user.username}.",
    )
    db.add(decision)
    db.commit()

    supervisor.record(
        db,
        "dispatch",
        "recommendation",
        rec.rationale,
        payload={"confidence": rec.confidence, "requested_by": user.username},
        incident_id=incident.id,
        resource_id=rec.best.resource.id,
        decision_id=decision.id,
        actor=user.username,
        escalated=True,
    )
    await bus.publish(Topic.DECISION_CREATED, supervisor.decision_payload(decision))
    return DecisionOut.model_validate(decision)


@router.get("/candidates/{incident_id}", response_model=list[dict])
async def list_candidates(
    incident_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_commander),
):
    """Everything the Dispatch Agent considered — so a commander overriding a
    recommendation can see the same shortlist the agent saw."""
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")
    candidates = dispatch_agent.gather_candidates(db, incident)
    scored = await dispatch_agent.score_with_routes(candidates, incident, supervisor.active_closures(db))
    return [c.to_payload() for c in scored]


@router.post("/preempt", response_model=ResourceOut)
async def preempt_unit(
    incident_id: int,
    resource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Pull a unit off its current job for a higher-priority incident (spec 4.6)."""
    incident = db.get(Incident, incident_id)
    resource = db.get(Resource, resource_id)
    if incident is None or resource is None:
        raise HTTPException(404, "That incident or unit does not exist.")
    await supervisor.preempt(db, incident, resource, actor=user)
    return ResourceOut.model_validate(resource)
