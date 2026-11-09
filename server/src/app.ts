import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { isAiConfigured } from './agents/triage/llmClassifier';
import { env } from './config/env';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { dispatchRouter } from './modules/dispatch/dispatch.routes';
import { feedsRouter } from './modules/feeds/feeds.routes';
import { geocodeRouter } from './modules/geocode/geocode.routes';
import { incidentsRouter } from './modules/incidents/incidents.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { resourcesRouter } from './modules/resources/resources.routes';

export function createApp() {
  const app = express();

  app.use(helmet()); // sensible security headers
  app.use(cors({ origin: env.CLIENT_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev')); // one log line per request

  // Public routes
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);

  // Everything below needs a logged-in user
  app.use('/api', requireAuth);

  app.get('/api/system', (_req, res) => {
    res.json({
      triageMode: isAiConfigured() ? 'ai' : 'rules',
      aiModel: isAiConfigured() ? env.GEMINI_MODEL : null,
    });
  });
  app.use('/api/reports', reportsRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/api/resources', resourcesRouter);
  app.use('/api/dispatch', dispatchRouter);
  app.use('/api/feeds', feedsRouter);
  app.use('/api/geocode', geocodeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
