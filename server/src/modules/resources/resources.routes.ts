import { Router } from 'express';
import { z } from 'zod';
import { CAPABILITIES, RESOURCE_STATUSES, RESOURCE_TYPES } from '../../domain';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { forbidden } from '../../utils/httpError';
import { logAudit } from '../audit/audit.service';
import * as resources from './resources.service';

export const resourcesRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const resourceSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(2, 'Code is too short').max(20, 'Code is too long'),
    name: z.string().trim().min(2, 'Name is too short').max(80),
    type: z.enum(RESOURCE_TYPES),
    status: z.enum(RESOURCE_STATUSES).default('available'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    homeBase: z.string().trim().max(80).default(''),
    capacity: z.number().int().min(0).max(10000),
    currentLoad: z.number().int().min(0).max(10000).default(0),
    capabilities: z.array(z.enum(CAPABILITIES)).default([]),
  })
  .refine((r) => r.currentLoad <= r.capacity, {
    message: 'Current load cannot be more than capacity',
    path: ['currentLoad'],
  });

/** GET /api/resources?includeRetired=true */
resourcesRouter.get('/', requireRole('commander', 'admin'), async (req, res) => {
  const includeRetired = req.query.includeRetired === 'true';
  res.json({ resources: await resources.listResources(includeRetired) });
});

/** GET /api/resources/summary  -> counts per type and status */
resourcesRouter.get('/summary', requireRole('commander', 'admin'), async (_req, res) => {
  res.json({ summary: await resources.resourceStatusSummary() });
});

/** GET /api/resources/:id  (responders may only see their own unit) */
resourcesRouter.get('/:id', async (req, res) => {
  const { id } = validate(idParam, req.params);
  if (req.user!.role === 'responder' && req.user!.resourceId !== id) {
    throw forbidden('You can only view your own unit.');
  }
  res.json({ resource: await resources.getResource(id) });
});

/** POST /api/resources  (admin) */
resourcesRouter.post('/', requireRole('admin'), async (req, res) => {
  const input = validate(resourceSchema, req.body);
  const resource = await resources.createResource(input);
  await logAudit({
    actorType: 'human', actorName: req.user!.name, action: 'resource.created',
    entityType: 'resource', entityId: resource.id,
    summary: `Added ${resource.code} (${resource.name}).`,
  });
  res.status(201).json({ resource });
});

/** PUT /api/resources/:id  (admin) */
resourcesRouter.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = validate(idParam, req.params);
  const input = validate(resourceSchema, req.body);
  const resource = await resources.updateResource(id, input);
  await logAudit({
    actorType: 'human', actorName: req.user!.name, action: 'resource.updated',
    entityType: 'resource', entityId: resource.id,
    summary: `Updated ${resource.code}.`,
    details: { status: resource.status },
  });
  res.json({ resource });
});

/** POST /api/resources/:id/retire  and  /restore  (admin) */
for (const action of ['retire', 'restore'] as const) {
  resourcesRouter.post(`/:id/${action}`, requireRole('admin'), async (req, res) => {
    const { id } = validate(idParam, req.params);
    const resource = await resources.setRetired(id, action === 'retire');
    await logAudit({
      actorType: 'human', actorName: req.user!.name, action: `resource.${action}d`,
      entityType: 'resource', entityId: resource.id,
      summary: `${action === 'retire' ? 'Retired' : 'Brought back'} ${resource.code}.`,
    });
    res.json({ resource });
  });
}
