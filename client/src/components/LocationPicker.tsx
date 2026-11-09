import { useEffect } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { CHENNAI_CENTER, pinIcon } from '../lib/mapStyle';

export interface Point {
  lat: number;
  lng: number;
}

interface Props {
  value: Point | null;
  onPick: (point: Point) => void;
  height?: number;
}

function ClickToPick({ onPick }: { onPick: (point: Point) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function FollowValue({ value }: { value: Point | null }) {
  const map = useMap();
  const lat = value?.lat;
  const lng = value?.lng;
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [map, lat, lng]);
  return null;
}

/** A small map: click anywhere to drop the pin. */
export function LocationPicker({ value, onPick, height = 320 }: Props) {
  return (
    <div className="location-picker" style={{ height }}>
      <MapContainer
        center={value ? [value.lat, value.lng] : CHENNAI_CENTER}
        zoom={value ? 15 : 12}
        style={{ height: '100%', width: '100%', borderRadius: 6 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPick onPick={onPick} />
        <FollowValue value={value} />
        {value && <Marker position={[value.lat, value.lng]} icon={pinIcon} />}
      </MapContainer>
    </div>
  );
}
