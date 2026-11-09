import { query } from '../../db/pool';
import { CAPABILITY_LABELS, type Capability } from '../../domain';
import type { Incident } from '../../modules/incidents/incidents.service';
import { RESOURCE_COLUMNS, type Resource } from '../../modules/resources/resources.service';
import { formatKm, formatMinutes } from '../../utils/geo';
import { getEtasTo, type Eta } from '../routing/routingAgent';
import { requirementFor, type Requirement } from './requirements';

/**
 * DISPATCH AGENT (SRS 4.5)
 *
 *  1. Find nearby AVAILABLE units of the right type, nearest first, using
 *     the PostGIS KNN operator "<->" on the GIST index (no distance loops).
 *  2. Check capability match and current load.
 *  3. Ask the Routing Agent for REAL road ETAs of the best few, because the
 *     nearest unit in a straight line is not always the fastest by road.
 *  4. Rank and explain the choice in plain language.
 *
 * It only RECOMMENDS. Nothing is dispatched until a commander approves.
 */

const NEARBY_LIMIT = 8; // units fetched from the database
const ROUTED_LIMIT = 4; // units we ask OSRM about

// Scoring weights (lower score = better). One missing capability counts
// like being 10 minutes further away; a full unit like 3 extra minutes.
const MISSING_CAPABILITY_PENALTY_MIN = 10;
const FULL_LOAD_PENALTY_MIN = 3;

export interface Candidate {
  resourceId: number;
  code: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  straightLineMeters: number;
  etaSeconds: number;
  roadMeters: number;
  etaSource: Eta['source'];
  matchedCapabilities: string[];
  missingCapabilities: string[];
  loadRatio: number;
  score: number;
}

export interface Recommendation {
  requirement: Requirement;
  candidates: Candidate[]; // best first
  rationale: string;
}

export async function recommendUnits(incident: Incident): Promise<Recommendation | null> {
  const requirement = requirementFor(incident.type, incident.severity);

  // 1. Nearest available units. The point is passed as a constant so that
  //    PostgreSQL can walk the GIST index in distance order (KNN search).
  const nearby = await query<Resource & { straightLineMeters: number }>(
    `SELECT ${RESOURCE_COLUMNS},
            ST_Distance(r.location, ST_MakePoint($1, $2)::geography) AS "straightLineMeters"
       FROM resources r
      WHERE r.type = ANY($3)
        AND r.status = 'available'
        AND r.retired_at IS NULL
        AND r.current_load < r.capacity
      ORDER BY r.location <-> ST_MakePoint($1, $2)::geography
      LIMIT $4`,
    [incident.lng, incident.lat, requirement.types, NEARBY_LIMIT],
  );
  if (nearby.length === 0) return null;

  // 2. Capability match. Prefer units that carry everything, then nearer ones.
  const withCapabilities = nearby.map((unit) => {
    const matched = requirement.capabilities.filter((c) => unit.capabilities.includes(c));
    const missing = requirement.capabilities.filter((c) => !unit.capabilities.includes(c));
    return { unit, matched, missing };
  });
  withCapabilities.sort(
    (a, b) => a.missing.length - b.missing.length || a.unit.straightLineMeters - b.unit.straightLineMeters,
  );
  const shortlist = withCapabilities.slice(0, ROUTED_LIMIT);

  // 3. Real road ETAs from the Routing Agent (one OSRM request for all)
  const etas = await getEtasTo(
    shortlist.map(({ unit }) => ({ lat: unit.lat, lng: unit.lng })),
    { lat: incident.lat, lng: incident.lng },
  );

  // 4. Score and rank
  const candidates: Candidate[] = shortlist.map(({ unit, matched, missing }, i) => {
    const loadRatio = unit.capacity > 0 ? unit.currentLoad / unit.capacity : 0;
    const etaMinutes = etas[i].durationSeconds / 60;
    const score = etaMinutes + missing.length * MISSING_CAPABILITY_PENALTY_MIN + loadRatio * FULL_LOAD_PENALTY_MIN;
    return {
      resourceId: unit.id,
      code: unit.code,
      name: unit.name,
      type: unit.type,
      lat: unit.lat,
      lng: unit.lng,
      straightLineMeters: Math.round(unit.straightLineMeters),
      etaSeconds: Math.round(etas[i].durationSeconds),
      roadMeters: Math.round(etas[i].distanceMeters),
      etaSource: etas[i].source,
      matchedCapabilities: matched,
      missingCapabilities: missing,
      loadRatio: Math.round(loadRatio * 100) / 100,
      score: Math.round(score * 10) / 10,
    };
  });
  candidates.sort((a, b) => a.score - b.score);

  return { requirement, candidates, rationale: explain(candidates, requirement) };
}

const capabilityList = (caps: string[]) => caps.map((c) => CAPABILITY_LABELS[c as Capability] ?? c).join(', ');

/**
 * Plain-language reason, e.g.
 * "AMB-04 recommended: 6 min by road (2.8 km), 3 min faster than AMB-07. Carries advanced life support."
 */
function explain(candidates: Candidate[], requirement: Requirement): string {
  const [best, runnerUp] = candidates;
  const parts: string[] = [];

  parts.push(`${best.code} recommended: ${formatMinutes(best.etaSeconds)} by road (${formatKm(best.roadMeters)})`);

  if (runnerUp) {
    const diffMin = Math.round((runnerUp.etaSeconds - best.etaSeconds) / 60);
    if (diffMin >= 1) {
      parts[0] += `, ${diffMin} min faster than ${runnerUp.code}.`;
    } else if (diffMin <= -1) {
      // The best unit is slower, so explain why it still wins.
      parts[0] += '.';
      parts.push(
        `${runnerUp.code} is ${-diffMin} min closer but ` +
          (runnerUp.missingCapabilities.length
            ? `lacks ${capabilityList(runnerUp.missingCapabilities)}.`
            : 'is more heavily loaded.'),
      );
    } else {
      parts[0] += `, about the same time as ${runnerUp.code}.`;
    }

    const nearestByLine = [...candidates].sort((a, b) => a.straightLineMeters - b.straightLineMeters)[0];
    if (nearestByLine.resourceId !== best.resourceId && nearestByLine.etaSeconds > best.etaSeconds) {
      parts.push(`${nearestByLine.code} looks nearer on the map but takes longer by road.`);
    }
  } else {
    parts[0] += '. It is the only suitable unit available right now.';
  }

  if (requirement.capabilities.length) {
    if (best.missingCapabilities.length === 0) {
      parts.push(`Carries ${capabilityList(best.matchedCapabilities)}.`);
    } else {
      const fullyEquipped = candidates.find((c) => c.missingCapabilities.length === 0);
      parts.push(
        fullyEquipped
          ? `Warning: it does not carry ${capabilityList(best.missingCapabilities)}. ` +
              `${fullyEquipped.code} does, but is ${Math.round((fullyEquipped.etaSeconds - best.etaSeconds) / 60)} min further away.`
          : `Warning: none of the nearby available units carries ${capabilityList(best.missingCapabilities)}.`,
      );
    }
  }

  if (best.etaSource === 'estimate') {
    parts.push('Road routing was unavailable, so times are rough estimates.');
  }

  return parts.join(' ');
}
