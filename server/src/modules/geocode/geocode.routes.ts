import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { validate } from '../../middleware/validate';
import { HttpError } from '../../utils/httpError';

/**
 * Geocoding = turning an address into coordinates (and back), using
 * OpenStreetMap's free Nominatim service.
 *
 * Nominatim's usage policy allows at most 1 request per second and asks
 * for an identifying User-Agent, so requests go through this server
 * (not the browser), are spaced out, and repeated lookups are cached.
 */
export const geocodeRouter = Router();

// Rough box around Greater Chennai, so search results prefer the demo city.
const CHENNAI_VIEWBOX = '79.95,13.30,80.40,12.75';

const cache = new Map<string, unknown>();
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/** Runs lookups strictly one after another, at least 1.1 s apart. */
function nominatim(path: string): Promise<any> {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  const run = queue.then(() => fetchNominatim(path));
  queue = run.catch(() => undefined);
  return run;
}

async function fetchNominatim(path: string): Promise<any> {
  if (cache.has(path)) return cache.get(path);

  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const response = await fetch(`${env.NOMINATIM_URL}${path}`, {
    headers: { 'User-Agent': 'DRRC-student-project/1.0', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!response?.ok) throw new HttpError(502, 'Address lookup is not available right now. Please pick the spot on the map.');
  const body = await response.json();
  if (cache.size > 500) cache.clear();
  cache.set(path, body);
  return body;
}

/** GET /api/geocode/search?q=Velachery Main Road  -> up to 5 matching places */
geocodeRouter.get('/search', async (req, res) => {
  const { q } = validate(z.object({ q: z.string().trim().min(3, 'Type at least 3 characters') }), req.query);
  const params = new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'in', viewbox: CHENNAI_VIEWBOX });
  const results: any[] = await nominatim(`/search?${params}`);
  res.json({
    results: results.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })),
  });
});

/** GET /api/geocode/reverse?lat=..&lng=..  -> readable address of a map point */
geocodeRouter.get('/reverse', async (req, res) => {
  const { lat, lng } = validate(
    z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
    req.query,
  );
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: 'json', zoom: '17' });
  const result = await nominatim(`/reverse?${params}`);
  res.json({ label: result?.display_name ?? null });
});
