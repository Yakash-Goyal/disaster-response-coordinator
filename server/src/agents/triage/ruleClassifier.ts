import { INCIDENT_TYPE_LABELS, SEVERITY_LABELS, type IncidentType } from '../../domain';
import type { Classification } from './types';

/**
 * Keyword-based fallback classifier.
 *
 * Used when no Gemini API key is configured or the AI call fails, so the
 * system keeps working. It is intentionally simple, so its results are
 * always treated as low-confidence and sent to a human for review.
 */

const TYPE_KEYWORDS: Record<Exclude<IncidentType, 'other'>, string[]> = {
  structural_collapse: ['collapse', 'collapsed', 'caved in', 'wall fell', 'building fell', 'roof fell',
    'roof caved', 'debris', 'rubble', 'cracks in the building', 'crumbled'],
  fire: ['fire', 'burning', 'flames', 'smoke', 'blaze', 'caught fire', 'explosion', 'gas leak'],
  medical: ['injured', 'injury', 'unconscious', 'bleeding', 'heart attack', 'not breathing',
    'breathing problem', 'fainted', 'pregnant', 'labour pain', 'labor pain', 'snake bite',
    'electrocuted', 'fracture', 'hurt', 'sick', 'fever', 'dialysis', 'medicine', 'ambulance'],
  flood: ['flood', 'flooded', 'flooding', 'waterlogged', 'waterlogging', 'water level', 'inundated',
    'submerged', 'knee deep', 'knee-deep', 'waist deep', 'waist-deep', 'neck deep', 'overflowing',
    'water entered', 'water inside', 'lake breach', 'rising water'],
  road_blockage: ['tree fell', 'fallen tree', 'uprooted', 'road blocked', 'blocked road', 'road closed',
    'subway closed', 'landslide', 'road caved', 'stuck in traffic', 'vehicles stuck'],
  power_outage: ['power cut', 'no power', 'no electricity', 'power outage', 'transformer', 'live wire',
    'electric pole', 'current cut', 'blackout'],
  supply_shortage: ['no food', 'no drinking water', 'drinking water', 'food packets', 'starving', 'hungry',
    'milk', 'supplies', 'ration', 'without food', 'without water'],
};

/** When two types match equally, the more life-threatening one wins. */
const TIE_BREAK_ORDER: IncidentType[] = ['structural_collapse', 'fire', 'medical', 'flood',
  'supply_shortage', 'road_blockage', 'power_outage'];

const BASE_SEVERITY: Record<IncidentType, number> = {
  structural_collapse: 5,
  fire: 4,
  medical: 3,
  flood: 3,
  supply_shortage: 2,
  road_blockage: 2,
  power_outage: 2,
  other: 2,
};

/** Words that suggest lives are at risk -> raise severity. */
const ESCALATION_WORDS = ['trapped', 'stranded', 'unconscious', 'not breathing', 'children', 'child',
  'elderly', 'old people', 'many people', 'families', 'dying', 'dead', 'critical', 'urgent', 'help',
  'sos', 'emergency', 'pregnant', 'bedridden', 'drowning', 'heavy bleeding', 'explosion'];

/** Words that suggest the situation is under control -> lower severity. */
const CALMING_WORDS = ['minor', 'small', 'no injuries', 'nobody hurt', 'no one hurt', 'under control',
  'already handled', 'slowly receding', 'receding'];

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function matches(text: string, words: string[]): string[] {
  return words.filter((word) => containsPhrase(text, word));
}

export function classifyWithRules(text: string): Classification {
  // 1. Count keyword hits for every incident type
  let bestType: IncidentType = 'other';
  let bestHits: string[] = [];
  for (const type of TIE_BREAK_ORDER) {
    const hits = matches(text, TYPE_KEYWORDS[type as Exclude<IncidentType, 'other'>]);
    if (hits.length > bestHits.length) {
      bestType = type;
      bestHits = hits;
    }
  }

  // 2. Severity: base value for the type, adjusted by urgent/calm words
  const escalations = matches(text, ESCALATION_WORDS);
  const calming = matches(text, CALMING_WORDS);
  let severity = BASE_SEVERITY[bestType];
  if (escalations.length >= 1) severity += 1;
  if (escalations.length >= 3) severity += 1;
  if (calming.length >= 1) severity -= 1;
  if (calming.length >= 2) severity -= 1;
  severity = Math.min(5, Math.max(1, severity));

  // 3. Confidence: never high, because keywords miss context and sarcasm
  const confidence = bestHits.length === 0 ? 0.2 : Math.min(0.5, 0.3 + 0.1 * bestHits.length);

  const reasonParts = [
    bestHits.length
      ? `Keyword match for "${INCIDENT_TYPE_LABELS[bestType]}": ${bestHits.map((h) => `"${h}"`).join(', ')}.`
      : 'No known keywords found, so the type could not be determined.',
    `Severity ${severity} (${SEVERITY_LABELS[severity]})` +
      (escalations.length ? `, raised because of: ${escalations.map((w) => `"${w}"`).join(', ')}` : '') +
      (calming.length ? `, lowered because of: ${calming.map((w) => `"${w}"`).join(', ')}` : '') +
      '.',
  ];

  return {
    type: bestType,
    severity,
    confidence,
    title: makeTitle(text),
    reason: reasonParts.join(' '),
  };
}

/** Short headline: the first sentence of the message, cut to a readable length. */
function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length > 70 ? `${firstSentence.slice(0, 70).trimEnd()}...` : firstSentence;
}
