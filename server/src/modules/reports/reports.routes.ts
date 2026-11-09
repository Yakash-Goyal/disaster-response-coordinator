import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ingestReport, listRecentReports } from './reports.service';

export const reportsRouter = Router();

const manualReportSchema = z.object({
  text: z.string().trim().min(10, 'Please describe what happened (at least 10 characters)').max(2000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(200).optional(),
  reporter: z.string().trim().max(100).optional(),
});

/**
 * POST /api/reports
 * Manual report entry, e.g. a control-room operator typing in a phone call
 * (simulates citizen reports, SRS 4.1).
 */
reportsRouter.post('/', requireRole('commander', 'admin'), async (req, res) => {
  const input = validate(manualReportSchema, req.body);
  const result = await ingestReport({ ...input, source: 'manual', createdBy: req.user!.id });
  res.status(201).json(result);
});

/** GET /api/reports/recent  -> latest incoming reports from every channel */
reportsRouter.get('/recent', requireRole('commander', 'admin'), async (_req, res) => {
  res.json({ reports: await listRecentReports() });
});
