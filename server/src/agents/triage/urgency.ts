import type { IncidentType } from '../../domain';

/**
 * URGENCY SCORE (0-100), SRS 4.2: based on severity, number of
 * corroborating reports, and incident type.
 *
 *   severity points      = severity x 15            (max 75)
 *   incident type points = see TYPE_POINTS below    (max 15)
 *   report points        = 2 per extra report       (max 10)
 *
 * The weights are a simple, explainable starting point and can be tuned
 * later using the after-action analytics.
 */
const TYPE_POINTS: Record<IncidentType, number> = {
  structural_collapse: 15,
  fire: 15,
  medical: 12,
  flood: 10,
  supply_shortage: 6,
  road_blockage: 5,
  power_outage: 5,
  other: 3,
};

export interface UrgencyInput {
  severity: number;
  type: IncidentType;
  reportCount: number;
}

export interface Urgency {
  score: number;
  reason: string;
}

export function computeUrgency({ severity, type, reportCount }: UrgencyInput): Urgency {
  const severityPoints = severity * 15;
  const typePoints = TYPE_POINTS[type];
  const extraReports = Math.max(0, reportCount - 1);
  const reportPoints = Math.min(10, extraReports * 2);
  const score = Math.min(100, severityPoints + typePoints + reportPoints);

  const reason =
    `Severity ${severity} gives ${severityPoints} pts, incident type gives ${typePoints} pts` +
    (extraReports > 0
      ? `, ${extraReports} confirming report${extraReports > 1 ? 's' : ''} add${extraReports > 1 ? '' : 's'} ${reportPoints} pts.`
      : ', no confirming reports yet.');

  return { score, reason };
}
