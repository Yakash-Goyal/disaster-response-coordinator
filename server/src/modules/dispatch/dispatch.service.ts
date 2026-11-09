import type pg from 'pg';
import { recommendUnits } from '../../agents/dispatch/dispatchAgent';
import { pool, query, withTransaction } from '../../db/pool';
import type { AuthUser } from '../../middleware/auth';
import { broadcast, sendToUser } from '../../realtime/socket';
import { badRequest, conflict, notFound } from '../../utils/httpError';
import { logAudit } from '../audit/audit.service';
import { getIncident, publishIncident } from '../incidents/incidents.service';
import { getResource, publish as publishResource } from '../resources/resources.service';

export interface DispatchDecision {
  id: number;
  incidentId: number;
  recommendedResourceId: number;
  resourceId: number | null;
  recommendation: { requirement: unknown; candidates: any[] };
  rationale: string;
  humanAction: 'pending' | 'accepted' | 'overridden' | 'superseded';
  overrideReason: string | null;
  decidedByName: string | null;
  createdAt: string;
  decidedAt: string | null;
}

type Db = Pick<pg.Pool, 'query'> | pg.PoolClient;

const DECISION_SELECT = `
  SELECT d.id, d.incident_id AS "incidentId", d.recommended_resource_id AS "recommendedResourceId",
         d.resource_id AS "resourceId", d.agent_recommendation AS recommendation, d.rationale,
         d.human_action AS "humanAction", d.override_reason AS "overrideReason",
         u.name AS "decidedByName", d.created_at AS "createdAt", d.decided_at AS "decidedAt"
    FROM dispatch_decisions d
    LEFT JOIN users u ON u.id = d.decided_by`;

async function getDecision(id: number, db: Db = pool): Promise<DispatchDecision> {
  const { rows } = await db.query<DispatchDecision>(`${DECISION_SELECT} WHERE d.id = $1`, [id]);
  if (!rows[0]) throw notFound(`Dispatch decision #${id} was not found.`);
  return rows[0];
}

export async function listDecisionsForIncident(incidentId: number): Promise<DispatchDecision[]> {
  return query<DispatchDecision>(`${DECISION_SELECT} WHERE d.incident_id = $1 ORDER BY d.created_at DESC`, [
    incidentId,
  ]);
}

/**
 * Runs the Dispatch Agent for an incident and stores its recommendation
 * as a PENDING decision. Any older pending recommendation is superseded.
 */
export async function createRecommendation(incidentId: number): Promise<DispatchDecision | null> {
  const incident = await getIncident(incidentId);
  if (incident.status !== 'open') {
    throw conflict('A unit has already been dispatched to this incident.');
  }

  const recommendation = await recommendUnits(incident);

  if (!recommendation) {
    await logAudit({
      actorType: 'agent',
      actorName: 'Dispatch Agent',
      action: 'dispatch.no_candidates',
      entityType: 'incident',
      entityId: incidentId,
      summary: 'No suitable unit is available right now. The incident stays in the queue.',
    });
    return null;
  }

  const best = recommendation.candidates[0];
  const decisionId = await withTransaction(async (client) => {
    await client.query(
      `UPDATE dispatch_decisions SET human_action = 'superseded'
        WHERE incident_id = $1 AND human_action = 'pending'`,
      [incidentId],
    );
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO dispatch_decisions (incident_id, recommended_resource_id, agent_recommendation, rationale)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [incidentId, best.resourceId,
       { requirement: recommendation.requirement, candidates: recommendation.candidates },
       recommendation.rationale],
    );
    return rows[0].id;
  });

  await logAudit({
    actorType: 'agent',
    actorName: 'Dispatch Agent',
    action: 'dispatch.recommended',
    entityType: 'dispatch_decision',
    entityId: decisionId,
    summary: recommendation.rationale,
    details: { candidates: recommendation.candidates.map((c) => ({ code: c.code, etaSeconds: c.etaSeconds, score: c.score })) },
  });

  const decision = await getDecision(decisionId);
  broadcast('decision:updated', decision);
  await publishIncident(incidentId);
  return decision;
}

/**
 * The commander's answer to a recommendation (human-in-the-loop, SRS 5):
 *   accept   -> send the recommended unit
 *   override -> send a different unit chosen by the commander
 */
export async function decide(
  decisionId: number,
  user: AuthUser,
  choice: { action: 'accept' } | { action: 'override'; resourceId: number; reason?: string },
): Promise<DispatchDecision> {
  const result = await withTransaction(async (client) => {
    // Lock the decision so two commanders cannot answer it at the same time.
    const { rows } = await client.query(
      `SELECT id, incident_id AS "incidentId", recommended_resource_id AS "recommendedResourceId", human_action AS "humanAction"
         FROM dispatch_decisions WHERE id = $1 FOR UPDATE`,
      [decisionId],
    );
    const decision = rows[0];
    if (!decision) throw notFound(`Dispatch decision #${decisionId} was not found.`);
    if (decision.humanAction !== 'pending') {
      throw conflict('This recommendation was already answered or replaced. Please refresh it.');
    }

    const resourceId = choice.action === 'accept' ? decision.recommendedResourceId : choice.resourceId;
    if (choice.action === 'override' && resourceId === decision.recommendedResourceId) {
      throw badRequest('That is the recommended unit. Use "Send" to accept the recommendation.');
    }

    const incidentRows = await client.query(`SELECT status FROM incidents WHERE id = $1 FOR UPDATE`, [
      decision.incidentId,
    ]);
    if (incidentRows.rows[0]?.status !== 'open') throw conflict('This incident already has a unit assigned.');

    const resourceRows = await client.query(
      `SELECT code, type, status, retired_at AS "retiredAt" FROM resources WHERE id = $1 FOR UPDATE`,
      [resourceId],
    );
    const resource = resourceRows.rows[0];
    if (!resource) throw notFound('That unit no longer exists.');
    if (resource.type === 'shelter') throw badRequest('A shelter cannot be dispatched. Please choose a unit.');
    if (resource.retiredAt || resource.status !== 'available') {
      throw conflict(`${resource.code} is no longer available. Ask the agent for a new recommendation.`);
    }

    await client.query(
      `UPDATE resources SET status = 'en_route', assigned_incident_id = $2, updated_at = now() WHERE id = $1`,
      [resourceId, decision.incidentId],
    );
    await client.query(
      `UPDATE incidents SET status = 'dispatched', dispatched_at = now(), updated_at = now() WHERE id = $1`,
      [decision.incidentId],
    );
    await client.query(
      `UPDATE dispatch_decisions
          SET human_action = $2, resource_id = $3, override_reason = $4, decided_by = $5, decided_at = now()
        WHERE id = $1`,
      [decisionId, choice.action === 'accept' ? 'accepted' : 'overridden', resourceId,
       choice.action === 'override' ? choice.reason || null : null, user.id],
    );

    return { incidentId: decision.incidentId as number, resourceId: resourceId as number, code: resource.code as string };
  });

  await logAudit({
    actorType: 'human',
    actorName: user.name,
    action: choice.action === 'accept' ? 'dispatch.accepted' : 'dispatch.overridden',
    entityType: 'dispatch_decision',
    entityId: decisionId,
    summary:
      choice.action === 'accept'
        ? `Accepted the recommendation and sent ${result.code}.`
        : `Overrode the recommendation and sent ${result.code} instead.` +
          (choice.reason ? ` Reason: ${choice.reason}` : ''),
  });

  const decision = await getDecision(decisionId);
  broadcast('decision:updated', decision);
  const resource = publishResource(await getResource(result.resourceId));
  const incident = await publishIncident(result.incidentId);

  // SRS 4.5: a task is pushed to the responder who crews this unit.
  const crew = await query<{ id: number }>('SELECT id FROM users WHERE resource_id = $1', [result.resourceId]);
  for (const member of crew) sendToUser(member.id, 'task:assigned', { incident, resource });

  return decision;
}
