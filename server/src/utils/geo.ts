export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Straight-line ("as the crow flies") distance in metres between two points
 * (haversine formula). Only used as a fallback when the road routing engine
 * is unreachable; normal distance queries run inside PostGIS.
 */
export function straightLineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000; // earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}
