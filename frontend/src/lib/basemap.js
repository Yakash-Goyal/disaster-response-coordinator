/* The dark basemap under every map. One place, so the command map and the
   responder map never drift apart.

   Esri's Dark Gray Canvas needs no API key. (CARTO's dark_all now serves an
   "API key required" placeholder, and OpenStreetMap's own tile servers block
   localhost referers.) Native tiles stop at zoom 16; Leaflet upscales beyond. */
import L from "leaflet";

const DARK_GRAY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

export function addBasemap(map) {
  return L.tileLayer(DARK_GRAY, {
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxNativeZoom: 16,
    maxZoom: 19,
    className: "basemap",
  }).addTo(map);
}
