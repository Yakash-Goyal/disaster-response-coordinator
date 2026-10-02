"""Triage Agent classification quality (spec 4.2)."""
import pytest

from app.agents.triage import count_hedges, heuristic_triage

CASES = [
    ("Water is rising fast on the market road, shops are flooding", "flood"),
    ("Smoke pouring from the second floor, people still inside", "fire"),
    ("The school boundary wall has collapsed, rubble everywhere", "structural_collapse"),
    ("Elderly man collapsed at the queue, unconscious and not responding", "medical"),
    ("Large tree down across the road, ambulances cannot pass", "road_blocked"),
    ("Transformer blew, whole lane has no electricity", "power_outage"),
    ("Strong chemical fumes from the storage yard, eyes burning", "hazmat"),
    ("Family stranded on the roof near the canal, water still rising", "rescue"),
    ("People on rooftops shouting for help", "rescue"),
]


@pytest.mark.parametrize("text,expected", CASES)
def test_classifies_incident_type(text, expected):
    assert heuristic_triage(text).type == expected


def test_person_collapse_is_medical_not_structural():
    """The keyword 'collapsed' is ambiguous; phrase context must settle it."""
    assert heuristic_triage("a woman collapsed on the pavement").type == "medical"
    assert heuristic_triage("the roof collapsed onto the pavement").type == "structural_collapse"


def test_severity_rises_with_corroborating_reports():
    text = "Flooding reported on the main road"
    assert heuristic_triage(text, report_count=6).severity >= heuristic_triage(text, 1).severity


def test_dampeners_lower_severity():
    high = heuristic_triage("Fire in the building, spreading rapidly, people trapped")
    low = heuristic_triage("Small fire, contained, no injuries")
    assert low.severity < high.severity


def test_hedged_reports_are_flagged_for_review():
    """A reporter who is unsure must not produce a confident incident."""
    vague = heuristic_triage("not sure what i saw, maybe smoke maybe just haze")
    certain = heuristic_triage("Flames visible from the second floor, smoke pouring out")
    assert vague.confidence < certain.confidence
    assert vague.needs_review is True
    assert certain.needs_review is False


def test_count_hedges():
    assert count_hedges("maybe, i think, not sure") == 3
    assert count_hedges("The building is on fire") == 0


def test_unrecognised_text_has_low_confidence():
    result = heuristic_triage("the weather is quite pleasant today")
    assert result.type == "other"
    assert result.needs_review is True


def test_capabilities_are_attached():
    assert "trauma_kit" in heuristic_triage("Man bleeding heavily, needs an ambulance").required_capabilities
