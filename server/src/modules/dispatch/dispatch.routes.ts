import { Router } from 'express';
import { z } from 'zod';
import { getRoute } from '../../agents/routing/routingAgent';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getIncident } from '../incidents/incidents.service';
import { getResource } from '../resources/resources.service';
import { createRecommendation, decide, listDecisionsForIncident } from './dispatch.service';

export const dispatchRouter = Router();

// Commanders make dispatch decisions; admins may look at them (read-only).
const commanderOnly = requireRole('commander');
const canView = requireRole('commander', 'admin');

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** POST /api/dispatch/incidents/:id/recommend  -> ask the Dispatch Agent for a unit */
dispatchRouter.post('/incidents/:id/recommend', commanderOnly, async (req, res) => {
  const { id } = validate(idParam, req.params);
  const decision = await createRecommendation(id);
  res.json({
    decision,
    message: decision ? null : 'No suitable unit is available right now. Try again when a unit is free.',
  });
});

/** GET /api/dispatch/incidents/:id/decisions  -> all recommendations for an incident, newest first */
dispatchRouter.get('/incidents/:id/decisions', canView, async (req, res) => {
  const { id } = validate(idParam, req.params);
  res.json({ decisions: await listDecisionsForIncident(id) });
});

/** POST /api/dispatch/decisions/:id/accept */
dispatchRouter.post('/decisions/:id/accept', commanderOnly, async (req, res) => {
  const { id } = validate(idParam, req.params);
  res.json({ decision: await decide(id, req.user!, { action: 'accept' }) });
});

/** POST /api/dispatch/decisions/:id/override  { resourceId, reason? } */
dispatchRouter.post('/decisions/:id/override', commanderOnly, async (req, res) => {
  const { id } = validate(idParam, req.params);
  const body = validate(
    z.object({
      resourceId: z.number().int().positive('Please choose a unit'),
      reason: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  res.json({ decision: await decide(id, req.user!, { action: 'override', ...body }) });
});

/** GET /api/dispatch/route?resourceId=1&incidentId=2  -> road route to draw on the map */
dispatchRouter.get('/route', canView, async (req, res) => {
  const { resourceId, incidentId } = validate(
    z.object({ resourceId: z.coerce.number().int().positive(), incidentId: z.coerce.number().int().positive() }),
    req.query,
  );
  const [resource, incident] = await Promise.all([getResource(resourceId), getIncident(incidentId)]);
  res.json({ route: await getRoute(resource, incident) });
});
