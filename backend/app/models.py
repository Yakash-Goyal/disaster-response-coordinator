"""ORM models — implements section 7 of the specification.

Locations are stored as plain lat/lng float columns so the schema works on
both SQLite and PostgreSQL. On PostgreSQL a generated `geography(Point)`
column plus a GiST index is added by app/geo.py at startup, and proximity
queries use `ST_DWithin` instead of the in-process index.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    TypeDecorator,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """A DateTime that always comes back timezone-aware, in UTC.

    SQLite has no timezone type, so plain `DateTime(timezone=True)` drops
    tzinfo on read. The API would then emit naive timestamps, which browsers
    parse as local time — every "5m ago" in the dashboard would be off by the
    viewer's UTC offset.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


# --------------------------------------------------------------------------
# Enumerations (stored as plain strings for portability + easy JSON output)
# --------------------------------------------------------------------------
class Role(str, enum.Enum):
    COMMANDER = "commander"
    RESPONDER = "responder"
    ADMIN = "admin"


class IncidentType(str, enum.Enum):
    FLOOD = "flood"
    FIRE = "fire"
    STRUCTURAL_COLLAPSE = "structural_collapse"
    MEDICAL = "medical"
    HAZMAT = "hazmat"
    POWER_OUTAGE = "power_outage"
    ROAD_BLOCKED = "road_blocked"
    RESCUE = "rescue"
    OTHER = "other"


class IncidentStatus(str, enum.Enum):
    PENDING = "pending"          # triaged, waiting on a dispatch decision
    AWAITING_APPROVAL = "awaiting_approval"
    ASSIGNED = "assigned"
    EN_ROUTE = "en_route"
    ON_SCENE = "on_scene"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class ResourceType(str, enum.Enum):
    AMBULANCE = "ambulance"
    SUPPLY_TRUCK = "supply_truck"
    PERSONNEL = "personnel"
    FIRE_ENGINE = "fire_engine"
    SHELTER = "shelter"


class ResourceStatus(str, enum.Enum):
    AVAILABLE = "available"
    EN_ROUTE = "en_route"
    ON_SCENE = "on_scene"
    RETURNING = "returning"
    OUT_OF_SERVICE = "out_of_service"
    RETIRED = "retired"          # soft-deleted; kept so the audit trail stays intact


class HumanAction(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    OVERRIDDEN = "overridden"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"


class ReportSource(str, enum.Enum):
    MANUAL = "manual"
    SOCIAL = "social"
    WEATHER = "weather"
    FIELD = "field"
    SENSOR = "sensor"


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=Role.COMMANDER.value)
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    resource = relationship("Resource", back_populates="operator", uselist=False)


class Report(Base):
    """A raw inbound signal. Many reports collapse into one incident."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(20), default=ReportSource.MANUAL.value, index=True)
    text: Mapped[str] = mapped_column(Text)
    reporter: Mapped[str | None] = mapped_column(String(120), nullable=True)
    lat: Mapped[float] = mapped_column(Float, index=True)
    lng: Mapped[float] = mapped_column(Float, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    incident = relationship("Incident", back_populates="reports")

    __table_args__ = (Index("ix_reports_geo", "lat", "lng"),)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(32), default=IncidentType.OTHER.value, index=True)
    severity: Mapped[int] = mapped_column(Integer, default=3)          # 1 (minor) .. 5 (critical)
    urgency_score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    status: Mapped[str] = mapped_column(String(24), default=IncidentStatus.PENDING.value, index=True)
    summary: Mapped[str] = mapped_column(String(400), default="")
    lat: Mapped[float] = mapped_column(Float, index=True)
    lng: Mapped[float] = mapped_column(Float, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    report_count: Mapped[int] = mapped_column(Integer, default=1)

    triage_confidence: Mapped[float] = mapped_column(Float, default=1.0)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    triage_source: Mapped[str] = mapped_column(String(24), default="heuristic")
    required_capabilities: Mapped[list] = mapped_column(JSON, default=list)
    manual_priority: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    first_dispatch_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    on_scene_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"), nullable=True)

    reports = relationship("Report", back_populates="incident")
    decisions = relationship("DispatchDecision", back_populates="incident")
    resources = relationship("Resource", back_populates="incident")

    __table_args__ = (Index("ix_incidents_geo", "lat", "lng"),)

    @property
    def is_open(self) -> bool:
        return self.status not in {IncidentStatus.RESOLVED.value, IncidentStatus.DISMISSED.value}


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    type: Mapped[str] = mapped_column(String(24), default=ResourceType.AMBULANCE.value, index=True)
    status: Mapped[str] = mapped_column(String(24), default=ResourceStatus.AVAILABLE.value, index=True)
    lat: Mapped[float] = mapped_column(Float, index=True)
    lng: Mapped[float] = mapped_column(Float, index=True)
    home_lat: Mapped[float] = mapped_column(Float)
    home_lng: Mapped[float] = mapped_column(Float)
    capabilities: Mapped[list] = mapped_column(JSON, default=list)
    capacity: Mapped[int] = mapped_column(Integer, default=1)
    speed_kmh: Mapped[float] = mapped_column(Float, default=45.0)

    incident_id: Mapped[int | None] = mapped_column(
        ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Live routing state driven by the simulation layer (section 4.10).
    route: Mapped[list | None] = mapped_column(JSON, nullable=True)      # [[lat,lng], ...]
    route_stops: Mapped[list | None] = mapped_column(JSON, nullable=True)  # multi-stop plan
    route_progress_m: Mapped[float] = mapped_column(Float, default=0.0)
    route_length_m: Mapped[float] = mapped_column(Float, default=0.0)
    eta_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    busy_seconds: Mapped[float] = mapped_column(Float, default=0.0)  # utilisation accumulator
    missions_completed: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    incident = relationship("Incident", back_populates="resources")
    operator = relationship("User", back_populates="resource", uselist=False)

    __table_args__ = (Index("ix_resources_geo", "lat", "lng"),)

    @property
    def is_dispatchable(self) -> bool:
        return self.status == ResourceStatus.AVAILABLE.value


class DispatchDecision(Base):
    """One agent recommendation and the human response to it (section 7)."""

    __tablename__ = "dispatch_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("incidents.id"), index=True)
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id"), nullable=True)

    agent_recommendation: Mapped[dict] = mapped_column(JSON, default=dict)
    alternatives: Mapped[list] = mapped_column(JSON, default=list)
    rationale: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    eta_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)

    escalated: Mapped[bool] = mapped_column(Boolean, default=True)
    escalation_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    human_action: Mapped[str] = mapped_column(String(20), default=HumanAction.PENDING.value, index=True)
    human_note: Mapped[str | None] = mapped_column(String(400), nullable=True)
    acted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    final_resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    incident = relationship("Incident", back_populates="decisions")


class AgentLog(Base):
    """Append-only audit trail (NFR: Auditability)."""

    __tablename__ = "agent_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    agent: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(64))
    detail: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("incidents.id"), nullable=True, index=True)
    resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id"), nullable=True)
    decision_id: Mapped[int | None] = mapped_column(ForeignKey("dispatch_decisions.id"), nullable=True)
    actor: Mapped[str] = mapped_column(String(64), default="system")  # "agent" | username
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class RoadClosure(Base):
    """Commander-reported blocked road; forces the Routing Agent to detour."""

    __tablename__ = "road_closures"

    id: Mapped[int] = mapped_column(primary_key=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[float] = mapped_column(Float, default=250.0)
    note: Mapped[str] = mapped_column(String(255), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
