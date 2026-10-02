"""Dispatch Agent ranking and the human-in-the-loop guarantee (spec 4.5, 4.7)."""
import asyncio

import pytest

from app.agents.dispatch import capability_match, gather_candidates, recommend, template_rationale
from app.models import Incident, IncidentStatus, IncidentType, Resource, ResourceStatus


def add_incident(db, **kwargs):
    defaults = dict(
        type=IncidentType.MEDICAL.value,
        severity=4,
        status=IncidentStatus.PENDING.value,
        summary="casualty",
        lat=30.7333,
        lng=76.7794,
        report_count=1,
        required_capabilities=["trauma_kit"],
    )
    defaults.update(kwargs)
    incident = Incident(**defaults)
    db.add(incident)
    db.commit()
    from app.geo import incident_index

    incident_index.upsert(incident.id, incident.lat, incident.lng)
    return incident


def test_capability_match_scores_partial_overlap():
    score, missing = capability_match(["trauma_kit", "oxygen"], ["trauma_kit"])
    assert score == 0.5
    assert missing == ["oxygen"]
    assert capability_match([], ["anything"]) == (1.0, [])


def test_candidates_exclude_busy_units_and_shelters(seeded):
    db = seeded
    incident = add_incident(db)
    busy = db.query(Resource).filter(Resource.type == "ambulance").first()
    busy.status = ResourceStatus.EN_ROUTE.value
    db.commit()

    candidates = gather_candidates(db, incident)
    ids = {c.resource.id for c in candidates}
    assert busy.id not in ids
    assert all(c.resource.type != "shelter" for c in candidates)
    assert all(c.resource.status == ResourceStatus.AVAILABLE.value for c in candidates)


def test_recommendation_prefers_capability_over_raw_proximity(seeded):
    """A slightly closer unit without the right kit should not automatically
    win — this is the behaviour the spec calls out as 'nearest != best'."""
    db = seeded
    for r in db.query(Resource).all():
        r.status = ResourceStatus.OUT_OF_SERVICE.value
    db.commit()

    close_wrong = Resource(
        name="Close No Kit", type="ambulance", status=ResourceStatus.AVAILABLE.value,
        lat=30.7340, lng=76.7800, home_lat=30.7340, home_lng=76.7800,
        capabilities=[], speed_kmh=45,
    )
    far_right = Resource(
        name="Further With Kit", type="ambulance", status=ResourceStatus.AVAILABLE.value,
        lat=30.7360, lng=76.7830, home_lat=30.7360, home_lng=76.7830,
        capabilities=["trauma_kit", "paramedic", "oxygen"], speed_kmh=45,
    )
    db.add_all([close_wrong, far_right])
    db.commit()
    from app.geo import resource_index

    for r in (close_wrong, far_right):
        resource_index.upsert(r.id, r.lat, r.lng)

    incident = add_incident(db, required_capabilities=["trauma_kit", "paramedic", "oxygen"])
    rec = asyncio.run(recommend(db, incident))
    assert rec.has_recommendation
    assert rec.best.resource.name == "Further With Kit"


def test_no_candidate_returns_an_actionable_reason(seeded):
    db = seeded
    for r in db.query(Resource).all():
        r.status = ResourceStatus.OUT_OF_SERVICE.value
    db.commit()

    rec = asyncio.run(recommend(db, add_incident(db)))
    assert not rec.has_recommendation
    assert rec.reason_no_candidate
    assert "unit" in rec.reason_no_candidate.lower()


def test_rationale_names_the_unit_and_a_number(seeded):
    """NFR 'Explainability': every recommendation carries a human-readable
    reason, not just a score."""
    db = seeded
    incident = add_incident(db)
    rec = asyncio.run(recommend(db, incident))
    assert rec.rationale
    assert rec.best.resource.name in rec.rationale
    assert any(ch.isdigit() for ch in rec.rationale)


def test_severity_four_is_never_auto_approved(seeded):
    """NFR 'Human override' — the ceiling must hold even with auto-approve on."""
    from app.agents.supervisor import run_dispatch_cycle
    from app.config import settings
    from app.models import DispatchDecision, HumanAction

    db = seeded
    original = settings.ALLOW_AUTO_APPROVE
    settings.ALLOW_AUTO_APPROVE = True
    try:
        add_incident(db, severity=5, type=IncidentType.FIRE.value, required_capabilities=[])
        asyncio.run(run_dispatch_cycle(db))
        decisions = db.query(DispatchDecision).all()
        assert decisions, "expected a recommendation"
        assert all(d.human_action == HumanAction.PENDING.value for d in decisions)
        assert all(d.escalated for d in decisions)
    finally:
        settings.ALLOW_AUTO_APPROVE = original


def test_conflict_resolution_never_double_books_a_unit(seeded):
    """Two incidents wanting the same nearest unit must not both get it."""
    from app.agents.supervisor import run_dispatch_cycle
    from app.models import DispatchDecision

    db = seeded
    add_incident(db, severity=5, lat=30.7340, lng=76.7800)
    add_incident(db, severity=4, lat=30.7341, lng=76.7801)
    asyncio.run(run_dispatch_cycle(db))

    assigned = [d.resource_id for d in db.query(DispatchDecision).all()]
    assert len(assigned) == len(set(assigned)), "a unit was recommended twice in one cycle"
