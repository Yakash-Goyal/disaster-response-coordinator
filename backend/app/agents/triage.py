"""Triage Agent — specification section 4.2.

Takes free-text report content and produces a structured classification:
incident type, severity 1-5, required capabilities, a one-line summary, and a
confidence value. Anything below `TRIAGE_REVIEW_THRESHOLD` is flagged for human
review rather than being silently accepted.

Two implementations sit behind one call. The LLM path does the real NLP; the
heuristic path is a weighted keyword classifier that runs with no network. The
heuristic result is also used to sanity-check the LLM: if the model returns a
type the keyword evidence flatly contradicts, confidence is reduced.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..config import settings
from ..models import IncidentType
from . import llm

# --------------------------------------------------------------------------
# Keyword model
# --------------------------------------------------------------------------
TYPE_KEYWORDS: dict[str, dict[str, float]] = {
    IncidentType.FLOOD.value: {
        "flood": 3.0, "flooding": 3.0, "water": 1.4, "submerged": 2.5, "waterlogged": 2.5,
        "overflow": 2.0, "drown": 2.6, "rising water": 3.0, "knee-deep": 2.2, "river": 1.2,
        "dam": 1.6, "sewage": 1.2, "inundated": 2.6,
    },
    IncidentType.FIRE.value: {
        "fire": 3.0, "burning": 2.8, "smoke": 2.2, "flames": 3.0, "blaze": 2.8,
        "explosion": 2.4, "gas leak": 1.6, "scorched": 1.8, "arson": 2.4,
    },
    IncidentType.STRUCTURAL_COLLAPSE.value: {
        # "collapse" already matches "collapsed"/"collapsing" via the \w* suffix —
        # listing both would double-count and beat the person-collapse context rule.
        "collapse": 3.2, "building down": 3.0, "rubble": 2.8,
        "debris": 1.8, "cracked": 1.6, "wall fell": 2.8, "roof caved": 3.0, "trapped": 2.2,
    },
    IncidentType.MEDICAL.value: {
        "injured": 2.6, "injury": 2.4, "bleeding": 3.0, "unconscious": 3.2, "cardiac": 3.2,
        "heart attack": 3.4, "breathing": 2.4, "ambulance": 2.0, "casualty": 2.4,
        "wound": 2.2, "fracture": 2.4, "hypothermia": 2.2, "dehydrated": 1.8,
    },
    IncidentType.HAZMAT.value: {
        "chemical": 3.0, "toxic": 3.0, "spill": 2.4, "fumes": 2.4, "hazmat": 3.4,
        "contamination": 2.6, "leak": 1.4, "acid": 2.2,
    },
    IncidentType.POWER_OUTAGE.value: {
        "power": 2.0, "outage": 2.8, "blackout": 3.0, "electricity": 2.2, "transformer": 2.4,
        "live wire": 2.6, "no lights": 2.0, "grid": 1.6,
    },
    IncidentType.ROAD_BLOCKED.value: {
        "road blocked": 3.2, "blocked": 2.0, "landslide": 2.8, "impassable": 2.8,
        "bridge": 1.6, "traffic": 1.2, "obstructed": 2.2, "debris across": 2.4,
        "road": 0.8, "lane": 0.6, "detour": 1.8,
    },
    IncidentType.RESCUE.value: {
        "stranded": 3.0, "trapped": 2.8, "rescue": 3.2, "stuck on roof": 3.4,
        "missing": 2.4, "cut off": 2.4, "cannot reach": 2.0, "evacuate": 2.2,
        "rooftop": 2.6, "roof": 1.6, "shouting": 1.8, "calling for help": 2.6,
        "need help": 1.8, "marooned": 3.0, "clinging": 2.6,
    },
}

SEVERITY_SIGNALS: dict[str, float] = {
    "dead": 2.0, "fatality": 2.0, "dying": 1.8, "unconscious": 1.6, "critical": 1.6,
    "children": 1.2, "child": 1.1, "elderly": 1.0, "hospital": 1.0, "school": 1.2,
    "many": 0.9, "dozens": 1.5, "hundreds": 2.0, "several": 0.7, "family": 0.8,
    "trapped": 1.4, "spreading": 1.2, "rapidly": 1.0, "urgent": 1.0, "immediately": 1.0,
    "severe": 1.2, "worsening": 1.0, "collapsing": 1.6, "screaming": 1.0,
}

DAMPENERS: dict[str, float] = {
    "minor": -1.2, "small": -0.8, "no injuries": -1.4, "contained": -1.2,
    "resolved": -1.6, "under control": -1.4, "false alarm": -2.5, "cleared": -1.4,
    "precaution": -0.9,
}

# Phrase-level evidence. Single keywords collide badly — "collapsed" means a
# building in one sentence and a person in the next — so these patterns carry
# more weight than any individual word and settle the ambiguous cases.
CONTEXT_RULES: list[tuple[str, str, float]] = [
    # person vs structure collapse
    (r"\b(man|woman|person|someone|somebody|boy|girl|child|kid|patient|elderly|he|she|they)\b[^.,;]{0,20}\bcollaps", IncidentType.MEDICAL.value, 4.2),
    (r"\b(wall|building|roof|structure|floor|ceiling|balcony|slab|bridge|house)\b[^.,;]{0,20}\b(collaps|came down|fell|caved|gave way)", IncidentType.STRUCTURAL_COLLAPSE.value, 3.6),
    (r"\bnot responding\b|\bnon[- ]responsive\b|\bno pulse\b", IncidentType.MEDICAL.value, 2.8),
    # road obstruction
    (r"\btree\b[^.,;]{0,15}\b(down|fell|fallen|across|blocking)", IncidentType.ROAD_BLOCKED.value, 3.2),
    (r"\b(can ?not|can't|cant|unable to|couldn't)\b[^.,;]{0,15}\b(pass|get through|reach|access)", IncidentType.ROAD_BLOCKED.value, 2.6),
    (r"\broad\b[^.,;]{0,15}\b(blocked|closed|cut off|impassable|under water|submerged)", IncidentType.ROAD_BLOCKED.value, 3.0),
    # water
    (r"\bwater\b[^.,;]{0,15}\b(rising|up to|knee|waist|chest|entering|inside)", IncidentType.FLOOD.value, 3.0),
    # people cut off by water is rescue, not plain flooding
    (r"\b(stranded|stuck|trapped)\b[^.,;]{0,25}\b(roof|rooftop|terrace|upper floor|tree|island)", IncidentType.RESCUE.value, 3.6),
    (r"\b(people|persons|family|families|residents|someone|children|kids|man|woman)\b[^.,;]{0,25}\b(on|atop|onto)\s+(the\s+)?(roof|rooftop|terrace|upper floor)", IncidentType.RESCUE.value, 3.6),
    (r"\b(shouting|screaming|calling|crying|waving)\b[^.,;]{0,15}\bfor help\b", IncidentType.RESCUE.value, 3.0),
    # fire
    (r"\b(smoke|flames|fire)\b[^.,;]{0,25}\b(coming|pouring|visible|spreading|from)", IncidentType.FIRE.value, 2.8),
    (r"\bstill inside\b|\bpeople inside\b", IncidentType.RESCUE.value, 2.2),
]

# Hedging language. A report the sender is unsure about should not arrive with
# the same confidence as one they witnessed — this is what pushes vague reports
# below the review threshold instead of letting them through as fact.
HEDGE_PATTERNS: list[str] = [
    r"\bnot sure\b", r"\bnot certain\b", r"\bmaybe\b", r"\bmight be\b", r"\bmight have\b",
    r"\bi think\b", r"\bpossibly\b", r"\bperhaps\b", r"\bunclear\b", r"\bcan't tell\b",
    r"\bcant tell\b", r"\blooks like\b", r"\bseems like\b", r"\bsomeone said\b",
    r"\bheard that\b", r"\brumou?r\b", r"\bapparently\b", r"\bcould be\b", r"\bnot confirmed\b",
    r"\bunconfirmed\b", r"\bhard to tell\b",
]

BASE_SEVERITY: dict[str, int] = {
    IncidentType.MEDICAL.value: 4,
    IncidentType.STRUCTURAL_COLLAPSE.value: 4,
    IncidentType.FIRE.value: 4,
    IncidentType.RESCUE.value: 4,
    IncidentType.HAZMAT.value: 4,
    IncidentType.FLOOD.value: 3,
    IncidentType.ROAD_BLOCKED.value: 2,
    IncidentType.POWER_OUTAGE.value: 2,
    IncidentType.OTHER.value: 2,
}

CAPABILITY_MAP: dict[str, list[str]] = {
    IncidentType.MEDICAL.value: ["trauma_kit", "paramedic"],
    IncidentType.FIRE.value: ["fire_suppression", "breathing_apparatus"],
    IncidentType.STRUCTURAL_COLLAPSE.value: ["heavy_lift", "search_dog", "cutting_gear"],
    IncidentType.FLOOD.value: ["boat", "water_pump"],
    IncidentType.RESCUE.value: ["boat", "rope_rescue"],
    IncidentType.HAZMAT.value: ["hazmat_suit", "decon_unit"],
    IncidentType.POWER_OUTAGE.value: ["generator", "electrician"],
    IncidentType.ROAD_BLOCKED.value: ["chainsaw", "heavy_lift"],
    IncidentType.OTHER.value: [],
}

VALID_TYPES = {t.value for t in IncidentType}


@dataclass
class TriageResult:
    type: str
    severity: int
    confidence: float
    summary: str
    required_capabilities: list[str] = field(default_factory=list)
    source: str = "heuristic"
    needs_review: bool = False
    reasoning: str = ""

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "severity": self.severity,
            "confidence": round(self.confidence, 3),
            "summary": self.summary,
            "required_capabilities": self.required_capabilities,
            "source": self.source,
            "needs_review": self.needs_review,
            "reasoning": self.reasoning,
        }


# --------------------------------------------------------------------------
# Heuristic classifier
# --------------------------------------------------------------------------
def _score_types(text: str) -> dict[str, float]:
    low = text.lower()
    scores: dict[str, float] = {}
    for itype, words in TYPE_KEYWORDS.items():
        total = 0.0
        for word, weight in words.items():
            if " " in word:
                if word in low:
                    total += weight
            elif re.search(rf"\b{re.escape(word)}\w*\b", low):
                total += weight
        if total:
            scores[itype] = total

    # Phrase evidence overrides isolated keyword collisions.
    for pattern, itype, weight in CONTEXT_RULES:
        if re.search(pattern, low):
            scores[itype] = scores.get(itype, 0.0) + weight
    return scores


def count_hedges(text: str) -> int:
    low = text.lower()
    return sum(1 for pattern in HEDGE_PATTERNS if re.search(pattern, low))


def heuristic_triage(text: str, report_count: int = 1) -> TriageResult:
    low = text.lower()
    scores = _score_types(text)

    if not scores:
        itype, confidence = IncidentType.OTHER.value, 0.30
        reasoning = "No recognised hazard keywords in the report text."
    else:
        ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        itype, top = ordered[0]
        runner_up = ordered[1][1] if len(ordered) > 1 else 0.0
        # Confidence rises with absolute evidence and with the margin over the
        # second-best type. Ambiguous reports land near the review threshold.
        strength = min(top / 6.0, 1.0)
        margin = (top - runner_up) / top if top else 0.0
        confidence = round(min(0.35 + 0.4 * strength + 0.28 * margin, 0.96), 3)
        matched = [w for w in TYPE_KEYWORDS[itype] if w in low][:4]
        reasoning = f"Keyword evidence for {itype}: {', '.join(matched) or 'weak'}."

    severity = float(BASE_SEVERITY.get(itype, 2))
    for signal, weight in SEVERITY_SIGNALS.items():
        if signal in low:
            severity += weight * 0.5
    for signal, weight in DAMPENERS.items():
        if signal in low:
            severity += weight
    if report_count > 1:
        severity += min(0.35 * (report_count - 1), 1.2)

    # Uncertainty in the reporter's own words lowers both what we believe and
    # how urgently we act on it.
    hedges = count_hedges(text)
    if hedges:
        confidence = round(max(confidence * (1 - 0.22 * hedges), 0.15), 3)
        severity -= min(0.7 * hedges, 1.6)
        reasoning += f" Reporter hedged ({hedges} uncertainty marker(s)) — flagged for confirmation."

    severity_int = max(1, min(5, round(severity)))
    summary = text.strip().split("\n")[0]
    summary = (summary[:117] + "...") if len(summary) > 120 else summary

    return TriageResult(
        type=itype,
        severity=severity_int,
        confidence=confidence,
        summary=summary,
        required_capabilities=CAPABILITY_MAP.get(itype, []),
        source="heuristic",
        needs_review=confidence < settings.TRIAGE_REVIEW_THRESHOLD,
        reasoning=reasoning,
    )


# --------------------------------------------------------------------------
# LLM classifier
# --------------------------------------------------------------------------
TRIAGE_SYSTEM = """You are the Triage Agent in a disaster response command system.
Classify a single incoming field report. Be conservative: if the text is vague,
contradictory, or could plausibly be more than one incident type, report LOW
confidence so a human commander reviews it. Never invent details that are not
in the report.

Reply with ONLY a JSON object, no prose and no code fences:
{
  "type": one of ["flood","fire","structural_collapse","medical","hazmat","power_outage","road_blocked","rescue","other"],
  "severity": integer 1-5 where 1 is minor and 5 is life-threatening at scale,
  "confidence": float 0.0-1.0,
  "summary": one short sentence, max 20 words, describing the situation,
  "required_capabilities": array of short snake_case equipment/skill tags,
  "reasoning": one sentence explaining the classification
}"""


async def llm_triage(text: str, report_count: int, address: str | None) -> TriageResult | None:
    context = f"Report text: {text!r}\nCorroborating reports at this location: {report_count}"
    if address:
        context += f"\nApproximate address: {address}"
    data = await llm.try_json(TRIAGE_SYSTEM, context)
    if not data:
        return None

    itype = str(data.get("type", "")).strip().lower()
    if itype not in VALID_TYPES:
        itype = IncidentType.OTHER.value
    try:
        severity = max(1, min(5, int(round(float(data.get("severity", 3))))))
    except (TypeError, ValueError):
        severity = 3
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        confidence = 0.5

    caps = data.get("required_capabilities") or CAPABILITY_MAP.get(itype, [])
    if not isinstance(caps, list):
        caps = CAPABILITY_MAP.get(itype, [])
    caps = [str(c).strip().lower().replace(" ", "_") for c in caps][:6]

    summary = str(data.get("summary") or text)[:200]
    reasoning = str(data.get("reasoning") or "")[:300]

    return TriageResult(
        type=itype,
        severity=severity,
        confidence=confidence,
        summary=summary,
        required_capabilities=caps,
        source="llm",
        reasoning=reasoning,
    )


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
async def triage_report(text: str, *, report_count: int = 1, address: str | None = None) -> TriageResult:
    baseline = heuristic_triage(text, report_count)
    result = await llm_triage(text, report_count, address)

    if result is None:
        return baseline

    # Cross-check the model against keyword evidence. Disagreement is not an
    # error, but it is a reason to be less sure and involve a human.
    if result.type != baseline.type and baseline.confidence > 0.7:
        result.confidence = min(result.confidence, 0.55)
        result.reasoning += f" (Keyword model suggested {baseline.type}; flagged for review.)"
    if not result.required_capabilities:
        result.required_capabilities = CAPABILITY_MAP.get(result.type, [])

    hedges = count_hedges(text)
    if hedges:
        result.confidence = round(max(result.confidence * (1 - 0.18 * hedges), 0.15), 3)

    result.needs_review = result.confidence < settings.TRIAGE_REVIEW_THRESHOLD
    return result
