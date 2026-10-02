"""HTTP surface: auth, RBAC, and the end-to-end intake pipeline."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(db):
    from app.main import app
    from app.seed.scenario import bootstrap

    bootstrap(db)
    with TestClient(app) as test_client:
        yield test_client


def token(client, username, password):
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def auth(client, username="commander", password="commander123"):
    return {"Authorization": f"Bearer {token(client, username, password)}"}


def test_health_is_public(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_login_rejects_bad_credentials(client):
    assert client.post("/api/auth/login", json={"username": "commander", "password": "wrong"}).status_code == 401


def test_protected_routes_require_a_token(client):
    assert client.get("/api/incidents").status_code == 401


def test_responder_cannot_approve_dispatch(client):
    """RBAC: only a commander puts a vehicle on the road."""
    headers = auth(client, "responder1", "responder123")
    res = client.post("/api/dispatch/decisions/1/action", json={"action": "accept"}, headers=headers)
    assert res.status_code == 403


def test_responder_cannot_add_resources(client):
    headers = auth(client, "responder1", "responder123")
    body = {"name": "X", "type": "ambulance", "lat": 30.7, "lng": 76.7}
    assert client.post("/api/resources", json=body, headers=headers).status_code == 403


def test_report_creates_a_triaged_incident(client):
    headers = auth(client)
    res = client.post(
        "/api/reports",
        json={"text": "Building on fire, flames on the second floor", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["triage"]["type"] == "fire"
    assert body["merged"] is False
    assert body["incident_id"]


def test_duplicate_report_merges_and_raises_report_count(client):
    headers = auth(client)
    first = client.post(
        "/api/reports",
        json={"text": "Water rising fast on the market road", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    ).json()
    second = client.post(
        "/api/reports",
        json={"text": "market road is flooding, water everywhere", "lat": 30.7334, "lng": 76.7795},
        headers=headers,
    ).json()

    assert second["merged"] is True
    assert second["incident_id"] == first["incident_id"]

    incident = client.get(f"/api/incidents/{first['incident_id']}", headers=headers).json()
    assert incident["report_count"] == 2
    assert len(incident["reports"]) == 2


def test_full_dispatch_cycle_requires_human_approval(client):
    headers = auth(client)
    client.post(
        "/api/reports",
        json={"text": "Man unconscious and bleeding heavily, not responding", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    decisions = client.post("/api/dispatch/run", headers=headers).json()
    assert decisions, "the supervisor should produce a recommendation"

    decision = decisions[0]
    assert decision["human_action"] == "pending"
    assert decision["rationale"]

    # Nothing has moved yet.
    unit = client.get(f"/api/resources/{decision['resource_id']}", headers=headers).json()
    assert unit["status"] == "available"

    approved = client.post(
        f"/api/dispatch/decisions/{decision['id']}/action",
        json={"action": "accept", "note": "confirmed"},
        headers=headers,
    ).json()
    assert approved["human_action"] == "accepted"

    unit = client.get(f"/api/resources/{decision['resource_id']}", headers=headers).json()
    assert unit["status"] == "en_route"
    assert unit["route"] and len(unit["route"]) > 1


def test_decision_cannot_be_ruled_on_twice(client):
    headers = auth(client)
    client.post(
        "/api/reports",
        json={"text": "Fire spreading through the warehouse", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    decision = client.post("/api/dispatch/run", headers=headers).json()[0]
    client.post(f"/api/dispatch/decisions/{decision['id']}/action", json={"action": "accept"}, headers=headers)
    repeat = client.post(
        f"/api/dispatch/decisions/{decision['id']}/action", json={"action": "accept"}, headers=headers
    )
    assert repeat.status_code == 409


def test_every_decision_is_written_to_the_audit_log(client):
    """NFR 'Auditability'."""
    headers = auth(client)
    client.post(
        "/api/reports",
        json={"text": "Chemical spill at the yard, fumes spreading", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    decision = client.post("/api/dispatch/run", headers=headers).json()[0]
    client.post(
        f"/api/dispatch/decisions/{decision['id']}/action",
        json={"action": "accept", "note": "radio confirmed"},
        headers=headers,
    )
    logs = client.get("/api/logs", headers=headers).json()
    actions = {log["action"] for log in logs}
    assert "incident_created" in actions
    assert "recommendation" in actions
    assert "decision_accepted" in actions
    assert any("radio confirmed" in log["detail"] for log in logs)


def test_analytics_reports_acceptance_rate(client):
    headers = auth(client)
    client.post(
        "/api/reports",
        json={"text": "Casualty bleeding heavily at the shelter", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    decision = client.post("/api/dispatch/run", headers=headers).json()[0]
    client.post(f"/api/dispatch/decisions/{decision['id']}/action", json={"action": "accept"}, headers=headers)

    summary = client.get("/api/analytics", headers=headers).json()
    assert summary["decisions_accepted"] == 1
    assert summary["agent_acceptance_rate"] == 1.0
    assert summary["reports_total"] >= 1


def test_timestamps_are_sent_as_utc(client):
    """SQLite drops tzinfo; a naive timestamp is read by browsers as local time."""
    headers = auth(client)
    created = client.post(
        "/api/reports",
        json={"text": "Building on fire, flames on the second floor", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    ).json()
    incident = client.get(f"/api/incidents/{created['incident_id']}", headers=headers).json()
    for field in ("created_at", "updated_at"):
        assert incident[field].endswith(("Z", "+00:00")), incident[field]


def test_admin_can_retire_a_unit_that_has_history(client):
    """Every unit has audit-log rows, so retiring must not hard-delete it."""
    headers = auth(client, "admin", "admin123")
    body = {"name": "Ambulance 99", "type": "ambulance", "lat": 30.73, "lng": 76.77}
    unit = client.post("/api/resources", json=body, headers=headers).json()

    assert client.delete(f"/api/resources/{unit['id']}", headers=headers).status_code == 204

    listed = {r["id"] for r in client.get("/api/resources", headers=headers).json()}
    assert unit["id"] not in listed
    logs = client.get("/api/logs", headers=headers).json()
    assert any(log["action"] == "resource_added" and log["resource_id"] == unit["id"] for log in logs)
    # The name is free for a replacement unit.
    assert client.post("/api/resources", json=body, headers=headers).status_code == 201


def test_rejected_unit_is_not_recommended_again(client):
    headers = auth(client)
    client.post(
        "/api/reports",
        json={"text": "Man unconscious and bleeding heavily, not responding", "lat": 30.7333, "lng": 76.7794},
        headers=headers,
    )
    first = client.post("/api/dispatch/run", headers=headers).json()[0]
    client.post(f"/api/dispatch/decisions/{first['id']}/action", json={"action": "reject"}, headers=headers)

    second = client.post("/api/dispatch/run", headers=headers).json()
    assert second, "the incident should get a fresh recommendation"
    assert second[0]["incident_id"] == first["incident_id"]
    assert second[0]["resource_id"] != first["resource_id"]
