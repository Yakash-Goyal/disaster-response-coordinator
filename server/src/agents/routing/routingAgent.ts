import { env } from '../../config/env';
import { straightLineMeters, type LatLng } from '../../utils/geo';
import { logger } from '../../utils/logger';

/**
 * ROUTING AGENT (SRS 4.6): real road distances and travel times from OSRM
 * (Open Source Routing Machine), which works on OpenStreetMap road data.
 *
 * If OSRM cannot be reached, we fall back to a rough estimate (straight line
 * x 1.4 for road bends, at 25 km/h average city speed) and label it as an
 * estimate everywhere, so nobody mistakes it for a real road ETA.
 */

const ROAD_FACTOR = 1.4; // roads are ~40% longer than the straight line in a city
const FALLBACK_SPEED_MPS = 25_000 / 3600; // 25 km/h in metres per second
const REQUEST_TIMEOUT_MS = 8_000;

export interface Eta {
  durationSeconds: number;
  distanceMeters: number;
  source: 'osrm' | 'estimate';
}

export interface Route extends Eta {
  /** The path as [lat, lng] points, ready to draw on the map. */
  path: [number, number][];
}

function estimate(from: LatLng, to: LatLng): Eta {
  const distanceMeters = straightLineMeters(from, to) * ROAD_FACTOR;
  return { distanceMeters, durationSeconds: distanceMeters / FALLBACK_SPEED_MPS, source: 'estimate' };
}

/** OSRM wants "lng,lat" pairs separated by ";" */
const toOsrm = (points: LatLng[]) => points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');

async function callOsrm(path: string): Promise<any> {
  const response = await fetch(`${env.OSRM_URL}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'DRRC-student-project/1.0' },
  });
  if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
  const body: any = await response.json();
  if (body.code !== 'Ok') throw new Error(`OSRM error: ${body.code} ${body.message ?? ''}`);
  return body;
}

/**
 * Travel time from many starting points to one destination in a single
 * request (OSRM "table" service). Used by the Dispatch Agent to compare
 * candidate units.
 */
export async function getEtasTo(origins: LatLng[], destination: LatLng): Promise<Eta[]> {
  if (origins.length === 0) return [];
  try {
    const sources = origins.map((_, i) => i).join(';');
    const body = await callOsrm(
      `/table/v1/driving/${toOsrm([...origins, destination])}` +
        `?sources=${sources}&destinations=${origins.length}&annotations=duration,distance`,
    );
    return origins.map((origin, i) => {
      const duration = body.durations?.[i]?.[0];
      const distance = body.distances?.[i]?.[0];
      // null means OSRM found no road connection for this pair
      if (duration == null || distance == null) return estimate(origin, destination);
      return { durationSeconds: duration, distanceMeters: distance, source: 'osrm' as const };
    });
  } catch (error) {
    logger.warn(`OSRM table request failed, using estimates: ${(error as Error).message}`);
    return origins.map((origin) => estimate(origin, destination));
  }
}

/** Full road route between two points, including the path to draw on the map. */
export async function getRoute(from: LatLng, to: LatLng): Promise<Route> {
  try {
    const body = await callOsrm(`/route/v1/driving/${toOsrm([from, to])}?overview=full&geometries=geojson`);
    const route = body.routes[0];
    return {
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      source: 'osrm',
      // GeoJSON uses [lng, lat]; Leaflet wants [lat, lng]
      path: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
    };
  } catch (error) {
    logger.warn(`OSRM route request failed, using a straight line: ${(error as Error).message}`);
    return { ...estimate(from, to), path: [[from.lat, from.lng], [to.lat, to.lng]] };
  }
}
