import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken } from "./api";

/* Single source of truth for live operational state.

   Everything arrives twice: once as a REST snapshot on mount, then as
   incremental WebSocket events. Merging both here means components only ever
   read plain arrays and never think about transport. */
export function useLiveState(enabled) {
  const [incidents, setIncidents] = useState([]);
  const [resources, setResources] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [closures, setClosures] = useState([]);
  const [status, setStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);
  const retryRef = useRef(0);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [inc, res, dec, lg, cls, st] = await Promise.all([
        api.incidents(),
        api.resources(),
        api.decisions("?limit=80"),
        api.logs("?limit=120"),
        api.closures(),
        api.status(),
      ]);
      setIncidents(inc);
      setResources(res);
      setDecisions(dec);
      setLogs(lg);
      setClosures(cls);
      setStatus(st);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const pushToast = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 7000);
  }, []);

  const upsert = useCallback((setter, item) => {
    setter((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx === -1) return [item, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...item };
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    aliveRef.current = true;
    refresh();

    function connect() {
      const token = getToken();
      if (!token || !aliveRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };

      socket.onclose = () => {
        setConnected(false);
        if (!aliveRef.current) return;
        // Exponential backoff, capped — a dropped socket during an incident
        // should recover on its own without hammering the server.
        retryRef.current += 1;
        const delay = Math.min(1000 * 2 ** (retryRef.current - 1), 15000);
        setTimeout(connect, delay);
      };

      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        const { topic, data } = message;

        switch (topic) {
          case "incident.created":
          case "incident.updated":
            upsert(setIncidents, data);
            break;
          case "incident.resolved":
            setIncidents((prev) => prev.filter((i) => i.id !== data.id));
            break;
          case "resource.updated":
            if (data.status === "retired") {
              setResources((prev) => prev.filter((r) => r.id !== data.id));
            } else {
              upsert(setResources, data);
            }
            break;
          case "resource.moved":
            setResources((prev) =>
              prev.map((r) => (r.id === data.id ? { ...r, ...data } : r))
            );
            break;
          case "decision.created":
            upsert(setDecisions, data);
            break;
          case "decision.resolved":
            upsert(setDecisions, data);
            break;
          case "log.appended":
            setLogs((prev) => [data, ...prev].slice(0, 200));
            break;
          case "closure.updated":
            api.closures().then(setClosures).catch(() => {});
            break;
          case "alert":
            pushToast(data);
            break;
          case "queue.tick":
            // Urgency ages server-side; pull the reordered queue so the spine
            // heights on screen match the scores the agents are ranking with.
            api.incidents().then(setIncidents).catch(() => {});
            break;
          default:
            break;
        }
      };
    }

    connect();
    return () => {
      aliveRef.current = false;
      socketRef.current?.close();
    };
  }, [enabled, refresh, upsert, pushToast]);

  return {
    incidents,
    resources,
    decisions,
    logs,
    closures,
    status,
    toasts,
    connected,
    error,
    refresh,
    pushToast,
    setIncidents,
    setResources,
    setDecisions,
  };
}
