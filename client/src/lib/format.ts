/** "just now", "4 min ago", "2 h ago", or a date for older items. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Clock time, e.g. "14:05". */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function km(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Shortens a long OpenStreetMap address to its first few parts. */
export function shortAddress(address: string | null, parts = 3): string {
  if (!address) return 'Location on map';
  return address.split(',').slice(0, parts).join(',').trim();
}
