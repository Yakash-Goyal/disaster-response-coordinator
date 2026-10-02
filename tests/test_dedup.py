"""Report deduplication (spec 4.1)."""
from app.models import Incident, IncidentStatus, IncidentType
from app.services.dedup import find_duplicate, jaccard, tokenise


def seed_incident(db, lat=30.7333, lng=76.7794, itype=IncidentType.FLOOD.value,
                  summary="Water rising fast on the market road"):
    incident = Incident(
        type=itype, severity=3, status=IncidentStatus.PENDING.value,
        summary=summary, lat=lat, lng=lng, report_count=1, required_capabilities=[],
    )
    db.add(incident)
    db.commit()
    from app.geo import incident_index

    incident_index.upsert(incident.id, incident.lat, incident.lng)
    return incident


def test_tokenise_drops_stopwords():
    assert "the" not in tokenise("the water is rising")
    assert "water" in tokenise("the water is rising")


def test_jaccard_similarity():
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
    assert jaccard({"a"}, {"b"}) == 0.0


def test_nearby_same_event_is_merged(db):
    existing = seed_incident(db)
    match, score = find_duplicate(
        db, 30.7334, 76.7795, "water rising on the market road, shops flooding",
        IncidentType.FLOOD.value,
    )
    assert match is not None and match.id == existing.id
    assert score >= 0.45


def test_distant_event_is_not_merged(db):
    seed_incident(db)
    match, _ = find_duplicate(db, 30.80, 76.90, "water rising fast", IncidentType.FLOOD.value)
    assert match is None


def test_incompatible_type_is_not_merged(db):
    """A medical emergency next to a power cut is not the same event."""
    seed_incident(db, itype=IncidentType.POWER_OUTAGE.value, summary="transformer blew")
    match, _ = find_duplicate(
        db, 30.7334, 76.7795, "man bleeding heavily", IncidentType.MEDICAL.value
    )
    assert match is None


def test_resolved_incidents_do_not_absorb_new_reports(db):
    existing = seed_incident(db)
    existing.status = IncidentStatus.RESOLVED.value
    db.commit()
    match, _ = find_duplicate(
        db, 30.7334, 76.7795, "water rising on the market road", IncidentType.FLOOD.value
    )
    assert match is None
