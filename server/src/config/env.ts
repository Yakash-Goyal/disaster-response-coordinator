import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * All configuration comes from environment variables (the .env file).
 * We validate it once at startup so a missing or wrong value fails fast
 * with a clear message, instead of breaking later in some random place.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),

  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),

  DEDUP_RADIUS_METERS: z.coerce.number().positive().default(500),
  DEDUP_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  TRIAGE_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

  SOCIAL_FEED_INTERVAL_SECONDS: z.coerce.number().positive().default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration in .env:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
