"""Urgency scoring and queue behaviour (spec 4.3)."""
from datetime import datetime, timedelta, timezone

from app.models import Incident, IncidentStatus, IncidentType
from app.services.queue import compute_urgency, merge_incidents, split_incident


def make(**kwargs):
    defaults = dict(
        type=IncidentType.FLOOD.value,
        severity=3,
        status=IncidentStatus.PENDING.value,
        summary="test",
        lat=30.73,
        lng=76.78,
        report_count=1,
        created_at=datetime.now(timezone.utc),
        required_capabilities=[],
    )
    defaults.update(kwargs)
    return Incident(**defaults)


def test_higher_severity_scores_higher():
    assert compute_urgency(make(severity=5)) > compute_urgency(make(severity=2))


def test_unaddressed_incidents_age_upward():
    """The ageing term is what stops an old incident being buried under new ones."""
    now = datetime.now(timezone.utc)
    fresh = make(created_at=now)
    stale = make(created_at=now - timedelta(minutes=40))
    assert compute_urgency(stale, now) > compute_urgency(fresh, now)


def test_ageing_stops_once_a_unit_is_working_it():
    now = datetime.now(timezone.utc)
    old = now - timedelta(minutes=40)
    pending = make(created_at=old, status=IncidentStatus.PENDING.value)
    on_scene = make(created_at=old, status=IncidentStatus.ON_SCENE.value)
    assert compute_urgency(on_scene, now) < compute_urgency(pending, now)


def test_corroboration_has_diminishing_returns():
    one, three, twelve = (compute_urgency(make(report_count=n)) for n in (1, 3, 12))
    assert one < three < twelve
    assert (twelve - three) < (three - one)


def test_manual_priority_overrides_everything():
    incident = make(severity=1, manual_priority=95.0)
    assert compute_urgency(incident) == 95.0


def test_score_is_clamped():
    assert 0 <= compute_urgency(make(severity=5, report_count=99)) <= 100


def test_merge_folds_reports_and_keeps_worst_severity(seeded):
    from app.models import Report

    db = seeded
    target = make(severity=2, required_capabilities=["boat"])
    source = make(severity=4, required_capabilities=["water_pump"])
    db.add_all([target, source])
    db.flush()
    db.add(Report(source="manual", text="a", lat=30.73, lng=76.78, incident_id=source.id))
    db.commit()

    merged = merge_incidents(db, source, target)
    assert merged.id == target.id
    assert merged.severity == 4
    assert set(merged.required_capabilities) == {"boat", "water_pump"}
    assert source.status == IncidentStatus.DISMISSED.value
    assert source.merged_into_id == target.id


def test_split_creates_a_new_incident_flagged_for_review(seeded):
    from app.models import Report

    db = seeded
    incident = make(report_count=2)
    db.add(incident)
    db.flush()
    a = Report(source="manual", text="first", lat=30.73, lng=76.78, incident_id=incident.id)
    b = Report(source="manual", text="second", lat=30.74, lng=76.79, incident_id=incident.id)
    db.add_all([a, b])
    db.commit()

    new = split_incident(db, incident, [b.id])
    assert new.id != incident.id
    assert new.needs_review is True
    assert b.incident_id == new.id
