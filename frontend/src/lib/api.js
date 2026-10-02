/* Thin API client. One place that knows about tokens and error shapes, so no
   component has to think about either. */

const TOKEN_KEY = "drc.token";
const USER_KEY = "drc.user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth) {
    clearSession();
    window.dispatchEvent(new Event("drc:signed-out"));
    throw new ApiError("Your session expired. Sign in again.", 401);
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg).join("; ");
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: { username, password }, auth: false }),

  status: () => request("/api/status"),
  incidents: (params = "") => request(`/api/incidents${params}`),
  incident: (id) => request(`/api/incidents/${id}`),
  updateIncident: (id, body) => request(`/api/incidents/${id}`, { method: "PATCH", body }),
  resolveIncident: (id) => request(`/api/incidents/${id}/resolve`, { method: "POST" }),
  mergeIncidents: (source, target) =>
    request("/api/incidents/merge", {
      method: "POST",
      body: { source_incident_id: source, target_incident_id: target },
    }),

  reports: (params = "") => request(`/api/reports${params}`),
  createReport: (body) => request("/api/reports", { method: "POST", body }),

  resources: (params = "") => request(`/api/resources${params}`),
  createResource: (body) => request("/api/resources", { method: "POST", body }),
  updateResource: (id, body) => request(`/api/resources/${id}`, { method: "PATCH", body }),
  retireResource: (id) => request(`/api/resources/${id}`, { method: "DELETE" }),
  multiStop: (resourceId, incidentIds) =>
    request("/api/resources/multi-stop", {
      method: "POST",
      body: { resource_id: resourceId, incident_ids: incidentIds },
    }),

  decisions: (params = "") => request(`/api/dispatch/decisions${params}`),
  actOnDecision: (id, action, resourceId, note) =>
    request(`/api/dispatch/decisions/${id}/action`, {
      method: "POST",
      body: { action, resource_id: resourceId ?? null, note: note ?? null },
    }),
  runCycle: () => request("/api/dispatch/run", { method: "POST" }),
  recommend: (incidentId, force = true) =>
    request("/api/dispatch/recommend", {
      method: "POST",
      body: { incident_id: incidentId, force },
    }),
  candidates: (incidentId) => request(`/api/dispatch/candidates/${incidentId}`),

  logs: (params = "") => request(`/api/logs${params}`),
  analytics: () => request("/api/analytics"),

  closures: () => request("/api/closures"),
  createClosure: (body) => request("/api/closures", { method: "POST", body }),
  clearClosure: (id) => request(`/api/closures/${id}`, { method: "DELETE" }),

  myTask: () => request("/api/responder/task"),
  setStatus: (status, note) =>
    request("/api/responder/status", { method: "POST", body: { status, note: note ?? null } }),

  triggerFlood: () => request("/api/scenario/flood", { method: "POST" }),
  triggerSocialPost: () => request("/api/scenario/social-post", { method: "POST" }),
  resetScenario: () => request("/api/scenario/reset", { method: "POST" }),
};
