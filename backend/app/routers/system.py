"""Audit log, analytics, road closures, scenario control, and the WebSocket."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents import routing, supervisor
from ..agents.llm import get_provider
from ..config import settings
from ..database import get_db
from ..events import Topic, bus
from ..geo import index_backend_name
from ..models import AgentLog, RoadClosure, User
from ..schemas import (
    AgentLogOut,
    AnalyticsSummary,
    ClosureCreate,
    ClosureOut,
    RouteOut,
    RouteRequest,
    SystemStatus,
)
from ..security import current_user, require_commander, websocket_user
from ..services.analytics import build_summary
from ..services.ingestion import ingestion
from ..services.orchestrator import orchestrator
from ..services.simulation import simulation

router = APIRouter(prefix="/api", tags=["system"])
ws_router = APIRouter()


# --------------------------------------------------------------------------
# Status
# --------------------------------------------------------------------------
@router.get("/status", response_model=SystemStatus)
def system_status(_user: User = Depends(current_user)) -> SystemStatus:
    provider = get_provider()
    return SystemStatus(
        version=settings.VERSION,
        llm_provider=provider.name,
        llm_model=settings.LLM_MODEL if provider.available else None,
        routing_provider=routing.provider_name(),
        spatial_backend=index_backend_name(),
        simulation_running=simulation.running,
        orchestrator_running=orchestrator.running,
        connected_clients=bus.client_count,
        auto_approve_enabled=settings.ALLOW_AUTO_APPROVE,
    )


@router.get("/health")
def health() -> dict:
    """Unauthenticated liveness probe."""
    return {"status": "ok", "version": settings.VERSION}


# --------------------------------------------------------------------------
# Audit log (NFR: Auditability)
# --------------------------------------------------------------------------
@router.get("/logs", response_model=list[AgentLogOut])
def list_logs(
    limit: int = Query(120, le=500),
    incident_id: int | None = None,
    agent: str | None = None,
    escalated_only: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    stmt = select(AgentLog).order_by(AgentLog.created_at.desc(), AgentLog.id.desc()).limit(limit)
    if incident_id is not None:
        stmt = stmt.where(AgentLog.incident_id == incident_id)
    if agent:
        stmt = stmt.where(AgentLog.agent == agent)
    if escalated_only:
        stmt = stmt.where(AgentLog.escalated.is_(True))
    return [AgentLogOut.model_validate(row) for row in db.scalars(stmt).all()]


# --------------------------------------------------------------------------
# Analytics (spec 4.12)
# --------------------------------------------------------------------------
@router.get("/analytics", response_model=AnalyticsSummary)
def analytics(db: Session = Depends(get_db), _user: User = Depends(current_user)):
    return AnalyticsSummary(**build_summary(db))


# --------------------------------------------------------------------------
# Road closures (spec 4.6 — live re-routing)
# --------------------------------------------------------------------------
@router.get("/closures", response_model=list[ClosureOut])
def list_closures(db: Session = Depends(get_db), _user: User = Depends(current_user)):
    rows = db.scalars(select(RoadClosure).where(RoadClosure.active.is_(True))).all()
    return [ClosureOut.model_validate(c) for c in rows]


@router.post("/closures", response_model=ClosureOut, status_code=201)
async def create_closure(
    payload: ClosureCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Report a blocked road. Every in-flight route through it is replanned."""
    closure = RoadClosure(
        lat=payload.lat, lng=payload.lng, radius_m=payload.radius_m, note=payload.note
    )
    db.add(closure)
    db.commit()

    rerouted = await supervisor.reroute_affected(db, closure)
    supervisor.record(
        db,
        "human",
        "closure_reported",
        f"{user.username} reported a road closure at {closure.lat:.4f}, {closure.lng:.4f} "
        f"({closure.radius_m:.0f} m). {rerouted} route(s) replanned."
        + (f" {closure.note}" if closure.note else ""),
        payload={"closure_id": closure.id, "rerouted": rerouted},
        actor=user.username,
    )
    await bus.publish(Topic.CLOSURE_UPDATED, {"closure": ClosureOut.model_validate(closure).model_dump(mode="json"), "rerouted": rerouted})
    return ClosureOut.model_validate(closure)


@router.delete("/closures/{closure_id}", status_code=204)
async def clear_closure(
    closure_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    closure = db.get(RoadClosure, closure_id)
    if closure is None:
        raise HTTPException(404, "No closure with that id.")
    closure.active = False
    db.commit()
    supervisor.record(db, "human", "closure_cleared",
                      f"{user.username} cleared the closure at {closure.lat:.4f}, {closure.lng:.4f}.",
                      actor=user.username)
    await bus.publish(Topic.CLOSURE_UPDATED, {"closure_id": closure_id, "active": False})


# --------------------------------------------------------------------------
# Routing preview
# --------------------------------------------------------------------------
@router.post("/route", response_model=RouteOut)
async def preview_route(
    payload: RouteRequest,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    route = await routing.get_route(
        payload.origin, payload.destination, closures=supervisor.active_closures(db)
    )
    return RouteOut(**route.as_dict())


# --------------------------------------------------------------------------
# Scenario control (spec 9)
# --------------------------------------------------------------------------
@router.post("/scenario/flood")
async def trigger_flood(
    stagger_seconds: float = Query(0.0, ge=0, le=5),
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Fire the seeded disaster burst through the live intake pipeline."""
    from ..seed.scenario import run_flood_scenario

    ids = await run_flood_scenario(db, stagger_seconds=stagger_seconds)
    supervisor.record(db, "human", "scenario_started",
                      f"{user.username} triggered the flood scenario: "
                      f"{len(ids)} reports across {len(set(ids))} incidents.",
                      actor=user.username)
    return {"reports": len(ids), "incidents": len(set(ids)), "incident_ids": sorted(set(ids))}


@router.post("/scenario/social-post")
async def trigger_social_post(_user: User = Depends(require_commander)):
    """Inject one synthetic social report on demand."""
    incident_id = await ingestion.emit_social_post()
    return {"incident_id": incident_id}


@router.post("/scenario/reset")
async def reset_scenario(db: Session = Depends(get_db), user: User = Depends(require_commander)):
    """Clear all operational data and re-seed the fleet. Accounts are kept."""
    from ..models import DispatchDecision, Incident, Report, Resource
    from ..seed.scenario import bootstrap

    for model in (AgentLog, DispatchDecision, Report, Incident, RoadClosure):
        db.query(model).delete()
    for resource in db.scalars(select(Resource).where(Resource.status != "retired")).all():
        resource.status = "available" if resource.type != "shelter" else "out_of_service"
        resource.incident_id = None
        resource.lat, resource.lng = resource.home_lat, resource.home_lng
        resource.route = None
        resource.route_stops = None
        resource.route_progress_m = 0.0
        resource.route_length_m = 0.0
        resource.eta_seconds = None
        resource.busy_seconds = 0.0
        resource.missions_completed = 0
    db.commit()
    bootstrap(db)
    supervisor.forget_incidents()  # incident ids are reused after the wipe

    supervisor.record(db, "human", "scenario_reset",
                      f"{user.username} reset the scenario.", actor=user.username)
    await bus.publish(Topic.ALERT, {"level": "info", "title": "Scenario reset",
                                    "message": "All incidents cleared and units returned to base."})
    return {"status": "reset"}


# --------------------------------------------------------------------------
# WebSocket (spec 3 — live incident/vehicle state)
# --------------------------------------------------------------------------
@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, user: User = Depends(websocket_user)):
    conn = await bus.connect(websocket, user.id, user.role, user.resource_id)
    try:
        await websocket.send_json(
            {
                "topic": "connected",
                "data": {
                    "user_id": user.id,
                    "role": user.role,
                    "resource_id": user.resource_id,
                    "recent": bus.recent(25),
                },
            }
        )
        while True:
            # Client messages are only used as a keepalive; all state flows out.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        await bus.disconnect(conn)
