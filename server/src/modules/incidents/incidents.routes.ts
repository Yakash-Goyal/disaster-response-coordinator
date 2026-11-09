import { Router } from 'express';
import { z } from 'zod';
import { INCIDENT_TYPES } from '../../domain';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as incidents from './incidents.service';

export const incidentsRouter = Router();

incidentsRouter.use(requireRole('commander', 'admin'));

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** GET /api/incidents            -> active incident queue, most urgent first
 *  GET /api/incidents?view=resolved -> recently resolved incidents */
incidentsRouter.get('/', async (req, res) => {
  const list =
    req.query.view === 'resolved' ? await incidents.listResolvedIncidents() : await incidents.listActiveIncidents();
  res.json({ incidents: list });
});

/** GET /api/incidents/:id  -> incident + its reports + its history */
incidentsRouter.get('/:id', async (req, res) => {
  const { id } = validate(idParam, req.params);
  res.json(await incidents.getIncidentDetails(id));
});

/** PUT /api/incidents/:id/classification  { type, severity }  (commander review) */
incidentsRouter.put('/:id/classification', requireRole('commander'), async (req, res) => {
  const { id } = validate(idParam, req.params);
  const input = validate(
    z.object({ type: z.enum(INCIDENT_TYPES), severity: z.number().int().min(1).max(5) }),
    req.body,
  );
  res.json({ incident: await incidents.reviewClassification(id, input, req.user!) });
});

/** POST /api/incidents/:id/status  { status: 'on_scene' | 'resolved' } */
incidentsRouter.post('/:id/status', requireRole('commander'), async (req, res) => {
  const { id } = validate(idParam, req.params);
  const { status } = validate(z.object({ status: z.enum(['on_scene', 'resolved']) }), req.body);
  res.json({ incident: await incidents.updateIncidentStatus(id, status, req.user!) });
});
