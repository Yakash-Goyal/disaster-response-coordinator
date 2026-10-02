import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../lib/api";
import { addBasemap } from "../lib/basemap";
import { eta, km, typeLabel } from "../lib/format";

/* Field responder view (spec 4.9).

   Mobile-first and deliberately narrow: someone reading this is in a moving
   vehicle. One assignment, one route, one next action — nothing else. */
function MiniMap({ route, incident, unit }) {
  const holder = useRef(null);
  const map = useRef(null);
  const layers = useRef({});

  useEffect(() => {
    if (map.current || !holder.current) return undefined;
    map.current = L.map(holder.current, { zoomControl: false, attributionControl: false }).setView(
      [unit?.lat ?? 30.7333, unit?.lng ?? 76.7794],
      14
    );
    addBasemap(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
      layers.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;

    if (route?.length > 1) {
      if (layers.current.route) layers.current.route.setLatLngs(route);
      else layers.current.route = L.polyline(route, { color: "#7fa9ff", weight: 3 }).addTo(m);
    }

    if (unit) {
      const pos = [unit.lat, unit.lng];
      if (layers.current.unit) layers.current.unit.setLatLng(pos);
      else
        layers.current.unit = L.circleMarker(pos, {
          radius: 7,
          color: "#101820",
          weight: 2,
          fillColor: "#5fbfa0",
          fillOpacity: 1,
        }).addTo(m);
      m.panTo(pos, { animate: true });
    }

    if (incident) {
      const pos = [incident.lat, incident.lng];
      if (layers.current.incident) layers.current.incident.setLatLng(pos);
      else
        layers.current.incident = L.circleMarker(pos, {
          radius: 9,
          color: "#101820",
          weight: 2,
          fillColor: "#ff4b3e",
          fillOpacity: 1,
        }).addTo(m);
    }
  }, [route, incident, unit]);

  return <div ref={holder} style={{ height: "100%", width: "100%" }} />;
}

export default function ResponderView({ resources }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.myTask().then(setTask).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  // Keep the unit marker moving with the simulation's position pings.
  const liveUnit = resources.find((r) => r.id === task?.resource?.id) || task?.resource;

  useEffect(() => {
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, []);

  async function setStatus(status) {
    setBusy(true);
    try {
      setTask(await api.setStatus(status));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !task) return <div className="error">{error}</div>;
  if (!task) return <div className="empty">Loading your assignment…</div>;

  const { incident, resource } = task;
  const status = liveUnit?.status ?? resource.status;

  return (
    <div className="responder">
      {error && <div className="error">{error}</div>}

      <div className="assignment">
        <span className="eyebrow">Your unit</span>
        <h2>{resource.name}</h2>
        <div className="queue-meta">
          <span className={`status-pill s-${status}`}>{status.replace(/_/g, " ")}</span>
          <span className="badge">{(resource.capabilities || []).join(" · ") || "no special kit"}</span>
        </div>
      </div>

      {incident ? (
        <>
          <div className="assignment">
            <span className="eyebrow">Assignment</span>
            <h2 className={`sev-${incident.severity}`}>
              {typeLabel(incident.type)} · #{incident.id}
            </h2>
            <p style={{ color: "var(--text-2)", margin: "0 0 10px" }}>{task.instructions}</p>
            <div className="facts">
              <div className="fact">
                <div className="eyebrow">ETA</div>
                <span className="eta-big">{eta(liveUnit?.eta_seconds ?? task.eta_seconds)}</span>
              </div>
              <div className="fact">
                <div className="eyebrow">Remaining</div>
                <b style={{ fontSize: 20 }}>
                  {km(
                    Math.max(
                      (liveUnit?.route_length_m ?? 0) - (liveUnit?.route_progress_m ?? 0),
                      0
                    )
                  )}
                </b>
              </div>
              <div className="fact">
                <div className="eyebrow">Severity</div>
                <b className={`sev-${incident.severity}`} style={{ fontSize: 20 }}>
                  {incident.severity}
                </b>
              </div>
            </div>
          </div>

          <div className="responder-map">
            <MiniMap route={task.route || liveUnit?.route} incident={incident} unit={liveUnit} />
          </div>

          <div className="step-actions">
            <button
              className="btn"
              disabled={busy || status === "en_route"}
              onClick={() => setStatus("en_route")}
            >
              1 · Rolling
            </button>
            <button
              className="btn"
              disabled={busy || status === "on_scene"}
              onClick={() => setStatus("on_scene")}
            >
              2 · On scene
            </button>
            <button className="btn primary" disabled={busy} onClick={() => setStatus("resolved")}>
              3 · Incident resolved
            </button>
          </div>
        </>
      ) : (
        <div className="assignment" style={{ borderLeftColor: "var(--ok)" }}>
          <span className="eyebrow">Standing by</span>
          <p style={{ color: "var(--text-2)" }}>
            No active assignment. You will be notified here the moment the commander sends you one.
          </p>
          <button className="btn ghost" onClick={() => setStatus("out_of_service")} disabled={busy}>
            Mark out of service
          </button>
        </div>
      )}
    </div>
  );
}
