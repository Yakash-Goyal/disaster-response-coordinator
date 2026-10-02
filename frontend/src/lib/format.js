/* Display helpers. Kept out of components so every ETA and timestamp in the
   product reads the same way. */

export const INCIDENT_LABELS = {
  flood: "Flood",
  fire: "Fire",
  structural_collapse: "Collapse",
  medical: "Medical",
  hazmat: "Hazmat",
  power_outage: "Power",
  road_blocked: "Road",
  rescue: "Rescue",
  other: "Other",
};

export const SEVERITY_COLORS = {
  1: "#4a8fbf",
  2: "#5fbfa0",
  3: "#f2c744",
  4: "#ff8a3d",
  5: "#ff4b3e",
};

export const UNIT_COLORS = {
  ambulance: "#ff8fa3",
  fire_engine: "#ff8a3d",
  personnel: "#7fa9ff",
  supply_truck: "#5fbfa0",
  shelter: "#b98cff",
};

export const UNIT_ABBR = {
  ambulance: "AMB",
  fire_engine: "ENG",
  personnel: "TEAM",
  supply_truck: "SUP",
  shelter: "SHL",
};

export function typeLabel(type) {
  return INCIDENT_LABELS[type] || (type || "").replace(/_/g, " ");
}

export function eta(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function km(meters) {
  if (meters === null || meters === undefined) return "—";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function clock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function ago(iso) {
  if (!iso) return "—";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function pct(value) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

export function statusLabel(status) {
  return (status || "").replace(/_/g, " ");
}
