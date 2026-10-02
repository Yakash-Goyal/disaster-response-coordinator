"""Pydantic v2 request/response models."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(ORMModel):
    id: int
    username: str
    name: str
    role: str
    resource_id: int | None = None


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------
class ReportCreate(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source: Literal["manual", "social", "weather", "field", "sensor"] = "manual"
    address: str | None = None
    reporter: str | None = None
    image_url: str | None = None


class ReportOut(ORMModel):
    id: int
    source: str
    text: str
    reporter: str | None
    lat: float
    lng: float
    address: str | None
    image_url: str | None
    created_at: datetime
    incident_id: int | None


class ReportIngestResult(BaseModel):
    report: ReportOut
    incident_id: int
    merged: bool
    triage: dict[str, Any]


# --------------------------------------------------------------------------
# Incidents
# --------------------------------------------------------------------------
class IncidentOut(ORMModel):
    id: int
    type: str
    severity: int
    urgency_score: float
    status: str
    summary: str
    lat: float
    lng: float
    address: str | None
    report_count: int
    triage_confidence: float
    needs_review: bool
    triage_source: str
    required_capabilities: list[str] = []
    created_at: datetime
    updated_at: datetime
    first_dispatch_at: datetime | None = None
    on_scene_at: datetime | None = None
    resolved_at: datetime | None = None


class IncidentDetail(IncidentOut):
    reports: list[ReportOut] = []
    decisions: list["DecisionOut"] = []
    assigned_resources: list["ResourceOut"] = []


class IncidentUpdate(BaseModel):
    severity: int | None = Field(default=None, ge=1, le=5)
    type: str | None = None
    status: str | None = None
    summary: str | None = None
    manual_priority: float | None = Field(default=None, ge=0, le=100)
    needs_review: bool | None = None


class MergeRequest(BaseModel):
    source_incident_id: int
    target_incident_id: int


class SplitRequest(BaseModel):
    report_ids: list[int] = Field(min_length=1)


# --------------------------------------------------------------------------
# Resources
# --------------------------------------------------------------------------
class ResourceCreate(BaseModel):
    name: str
    type: Literal["ambulance", "supply_truck", "personnel", "fire_engine", "shelter"]
    lat: float
    lng: float
    capabilities: list[str] = []
    capacity: int = 1
    speed_kmh: float = 45.0


class ResourceUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    capabilities: list[str] | None = None
    capacity: int | None = None
    speed_kmh: float | None = None
    lat: float | None = None
    lng: float | None = None


class ResourceOut(ORMModel):
    id: int
    name: str
    type: str
    status: str
    lat: float
    lng: float
    capabilities: list[str] = []
    capacity: int
    speed_kmh: float
    incident_id: int | None
    route: list[list[float]] | None = None
    route_stops: list[dict[str, Any]] | None = None
    route_progress_m: float
    route_length_m: float
    eta_seconds: float | None
    missions_completed: int


# --------------------------------------------------------------------------
# Dispatch decisions
# --------------------------------------------------------------------------
class DecisionOut(ORMModel):
    id: int
    incident_id: int
    resource_id: int | None
    agent_recommendation: dict[str, Any] = {}
    alternatives: list[dict[str, Any]] = []
    rationale: str
    confidence: float
    eta_seconds: float | None
    distance_m: float | None
    escalated: bool
    escalation_reason: str | None
    human_action: str
    human_note: str | None
    final_resource_id: int | None
    created_at: datetime
    decided_at: datetime | None


class DecisionAction(BaseModel):
    action: Literal["accept", "override", "reject"]
    resource_id: int | None = None  # required when action == "override"
    note: str | None = None


class DispatchRequest(BaseModel):
    incident_id: int
    force: bool = False


# --------------------------------------------------------------------------
# Responder
# --------------------------------------------------------------------------
class ResponderStatusUpdate(BaseModel):
    status: Literal["en_route", "on_scene", "resolved", "available", "out_of_service"]
    note: str | None = None


class ResponderTask(BaseModel):
    resource: ResourceOut
    incident: IncidentOut | None
    route: list[list[float]] | None
    eta_seconds: float | None
    instructions: str


# --------------------------------------------------------------------------
# Routing / closures
# --------------------------------------------------------------------------
class RouteRequest(BaseModel):
    origin: list[float] = Field(min_length=2, max_length=2)
    destination: list[float] = Field(min_length=2, max_length=2)
    profile: str = "driving"


class MultiStopRequest(BaseModel):
    resource_id: int
    incident_ids: list[int] = Field(min_length=1)


class RouteOut(BaseModel):
    geometry: list[list[float]]
    distance_m: float
    duration_s: float
    provider: str
    detoured: bool = False
    stops: list[dict[str, Any]] = []


class ClosureCreate(BaseModel):
    lat: float
    lng: float
    radius_m: float = 250.0
    note: str = ""


class ClosureOut(ORMModel):
    id: int
    lat: float
    lng: float
    radius_m: float
    note: str
    active: bool
    created_at: datetime


# --------------------------------------------------------------------------
# Logs / analytics
# --------------------------------------------------------------------------
class AgentLogOut(ORMModel):
    id: int
    agent: str
    action: str
    detail: str
    payload: dict[str, Any] | None
    incident_id: int | None
    resource_id: int | None
    decision_id: int | None
    actor: str
    escalated: bool
    created_at: datetime


class IncidentTiming(BaseModel):
    incident_id: int
    type: str
    severity: int
    seconds_to_dispatch: float | None
    seconds_to_on_scene: float | None
    seconds_to_resolve: float | None


class AnalyticsSummary(BaseModel):
    generated_at: datetime
    incidents_total: int
    incidents_open: int
    incidents_resolved: int
    reports_total: int
    dedup_ratio: float
    median_seconds_to_dispatch: float | None
    median_seconds_to_on_scene: float | None
    median_seconds_to_resolve: float | None
    agent_acceptance_rate: float | None
    decisions_total: int
    decisions_accepted: int
    decisions_overridden: int
    decisions_rejected: int
    decisions_pending: int
    resource_utilisation: list[dict[str, Any]]
    incidents_by_type: dict[str, int]
    incidents_by_severity: dict[str, int]
    timings: list[IncidentTiming]


class SystemStatus(BaseModel):
    version: str
    llm_provider: str
    llm_model: str | None
    routing_provider: str
    spatial_backend: str
    simulation_running: bool
    orchestrator_running: bool
    connected_clients: int
    auto_approve_enabled: bool


TokenResponse.model_rebuild()
IncidentDetail.model_rebuild()
