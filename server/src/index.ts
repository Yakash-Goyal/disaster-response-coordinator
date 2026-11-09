import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { initRealtime } from './realtime/socket';
import { logger } from './utils/logger';
import { isAiConfigured } from './agents/triage/llmClassifier';

async function main() {
  // Check the database before accepting requests, so a wrong DATABASE_URL
  // shows a clear message instead of failing on the first click.
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    logger.error(`Cannot connect to the database. Check DATABASE_URL in server/.env (${(error as Error).message})`);
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server); // WebSockets share the same port as the API

  server.listen(env.PORT, () => {
    logger.info(`API and live updates running on http://localhost:${env.PORT}`);
    logger.info(
      isAiConfigured()
        ? `Triage Agent: AI mode (${env.GEMINI_MODEL})`
        : 'Triage Agent: keyword mode (add GEMINI_API_KEY to server/.env to enable AI)',
    );
  });

  const shutdown = () => {
    logger.info('Shutting down...');
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
