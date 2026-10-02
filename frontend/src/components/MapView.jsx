import { useEffect, useRef } from "react";
import L from "leaflet";
import { addBasemap } from "../lib/basemap";
import { SEVERITY_COLORS, UNIT_ABBR, UNIT_COLORS, eta, typeLabel } from "../lib/format";

/* Live operational map.

   Leaflet is driven imperatively rather than re-created on every render: with
   position pings arriving every second for a dozen units, tearing down and
   rebuilding markers would make the whole map flicker. Instead each entity
   keeps a stable marker and only its position and style are updated. */

function incidentIcon(incident) {
  const size = 12 + incident.severity * 3;
  const color = SEVERITY_COLORS[incident.severity] || "#8298ac";
  const pulse = incident.severity >= 5 && incident.status === "pending" ? " pulse" : "";
  return L.divIcon({
    className: "",
    html: `<div class="marker-incident${pulse}" style="width:${size}px;height:${size}px;background:${color};opacity:${
      incident.status === "resolved" ? 0.3 : 0.92
    }"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function unitIcon(resource) {
  const color = UNIT_COLORS[resource.type] || "#8298ac";
  const dim = resource.status === "out_of_service" ? 0.4 : 1;
  const label = UNIT_ABBR[resource.type] || "UNIT";
  const w = label.length * 7 + 10;
  return L.divIcon({
    className: "",
    html: `<div class="marker-unit" style="width:${w}px;height:16px;background:${color};opacity:${dim}">${label}</div>`,
    iconSize: [w, 16],
    iconAnchor: [w / 2, 8],
  });
}

export default function MapView({
  incidents,
  resources,
  closures,
  selectedId,
  onSelectIncident,
  center,
  placingClosure,
  onPlaceClosure,
}) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ incidents: {}, resources: {}, routes: {}, closures: {} });
  const fittedRef = useRef(false);

  // --- map creation (once) ------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !holderRef.current) return undefined;

    const map = L.map(holderRef.current, {
      center: center || [30.7333, 76.7794],
      zoom: 13,
      zoomControl: true,
      attributionControl: true,
    });

    addBasemap(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = { incidents: {}, resources: {}, routes: {}, closures: {} };
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- click-to-place closure --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const handler = (event) => {
      if (placingClosure) onPlaceClosure?.(event.latlng.lat, event.latlng.lng);
    };
    map.on("click", handler);
    if (holderRef.current) {
      holderRef.current.style.cursor = placingClosure ? "crosshair" : "";
    }
    return () => map.off("click", handler);
  }, [placingClosure, onPlaceClosure]);

  // --- incidents ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = layersRef.current.incidents;
    const seen = new Set();

    incidents.forEach((incident) => {
      seen.add(incident.id);
      const pos = [incident.lat, incident.lng];
      const popup = `<b>#${incident.id} ${typeLabel(incident.type)}</b><br/>
        Severity ${incident.severity} · urgency ${incident.urgency_score?.toFixed?.(0) ?? "—"}<br/>
        ${incident.report_count} report(s) · ${incident.status.replace(/_/g, " ")}<br/>
        <span style="color:#b3c3d2">${incident.summary || ""}</span>`;

      if (layer[incident.id]) {
        layer[incident.id].setLatLng(pos).setIcon(incidentIcon(incident)).setPopupContent(popup);
      } else {
        const marker = L.marker(pos, { icon: incidentIcon(incident), zIndexOffset: 400 })
          .addTo(map)
          .bindPopup(popup);
        marker.on("click", () => onSelectIncident?.(incident.id));
        layer[incident.id] = marker;
      }
    });

    Object.keys(layer).forEach((id) => {
      if (!seen.has(Number(id))) {
        map.removeLayer(layer[id]);
        delete layer[id];
      }
    });

    if (!fittedRef.current && incidents.length > 1) {
      map.fitBounds(L.latLngBounds(incidents.map((i) => [i.lat, i.lng])).pad(0.25));
      fittedRef.current = true;
    }
  }, [incidents, onSelectIncident]);

  // --- units and their routes --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const units = layersRef.current.resources;
    const routes = layersRef.current.routes;
    const seen = new Set();

    resources.forEach((resource) => {
      seen.add(resource.id);
      const pos = [resource.lat, resource.lng];
      const popup = `<b>${resource.name}</b><br/>
        ${resource.status.replace(/_/g, " ")}${
          resource.incident_id ? ` · incident #${resource.incident_id}` : ""
        }<br/>
        ${resource.eta_seconds ? `ETA ${eta(resource.eta_seconds)}<br/>` : ""}
        <span style="color:#8298ac;font-size:11px">${(resource.capabilities || []).join(", ")}</span>`;

      if (units[resource.id]) {
        units[resource.id].setLatLng(pos).setIcon(unitIcon(resource)).setPopupContent(popup);
      } else {
        units[resource.id] = L.marker(pos, { icon: unitIcon(resource), zIndexOffset: 600 })
          .addTo(map)
          .bindPopup(popup);
      }

      // Route line, drawn only while the unit is actually moving.
      const moving = resource.status === "en_route" || resource.status === "returning";
      if (moving && resource.route && resource.route.length > 1) {
        const color = UNIT_COLORS[resource.type] || "#7fa9ff";
        if (routes[resource.id]) {
          routes[resource.id].setLatLngs(resource.route);
        } else {
          routes[resource.id] = L.polyline(resource.route, {
            color,
            weight: 2,
            opacity: 0.6,
            dashArray: "5,6",
          }).addTo(map);
        }
      } else if (routes[resource.id]) {
        map.removeLayer(routes[resource.id]);
        delete routes[resource.id];
      }
    });

    Object.keys(units).forEach((id) => {
      if (!seen.has(Number(id))) {
        map.removeLayer(units[id]);
        delete units[id];
        if (routes[id]) {
          map.removeLayer(routes[id]);
          delete routes[id];
        }
      }
    });
  }, [resources]);

  // --- road closures ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = layersRef.current.closures;
    const seen = new Set();

    (closures || []).forEach((closure) => {
      seen.add(closure.id);
      if (!layer[closure.id]) {
        layer[closure.id] = L.circle([closure.lat, closure.lng], {
          radius: closure.radius_m,
          color: "#ff4b3e",
          weight: 1,
          fillColor: "#ff4b3e",
          fillOpacity: 0.13,
          dashArray: "4,4",
        })
          .addTo(map)
          .bindPopup(`<b>Road closed</b><br/>${closure.note || "Reported blocked"}`);
      }
    });

    Object.keys(layer).forEach((id) => {
      if (!seen.has(Number(id))) {
        map.removeLayer(layer[id]);
        delete layer[id];
      }
    });
  }, [closures]);

  // --- follow the selected incident --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const incident = incidents.find((i) => i.id === selectedId);
    if (incident) {
      map.panTo([incident.lat, incident.lng], { animate: true });
      layersRef.current.incidents[selectedId]?.openPopup();
    }
  }, [selectedId, incidents]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <div ref={holderRef} className="map" />
      <div className="map-legend">
        <div className="eyebrow">Severity</div>
        {[5, 4, 3, 2, 1].map((s) => (
          <div className="legend-row" key={s}>
            <span className="legend-swatch" style={{ background: SEVERITY_COLORS[s] }} />
            {s === 5 ? "5 — critical" : s === 1 ? "1 — minor" : s}
          </div>
        ))}
      </div>
      {placingClosure && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 600,
            background: "rgba(255,75,62,0.92)",
            color: "#12191f",
            padding: "6px 12px",
            borderRadius: 3,
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          Click the map to mark the blocked road
        </div>
      )}
    </div>
  );
}
