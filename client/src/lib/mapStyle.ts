import L from 'leaflet';
import type { Resource, ResourceStatus, ResourceType } from '../api/types';

/** Map colours. Kept in sync with the CSS variables in global.css. */
export const SEVERITY_COLORS: Record<number, string> = {
  1: '#6b7a8c',
  2: '#3b7d4f',
  3: '#b8860b',
  4: '#d0561b',
  5: '#b42318',
};

export const STATUS_COLORS: Record<ResourceStatus, string> = {
  available: '#17703f',
  en_route: '#1f4fa8',
  on_scene: '#7a4bb0',
  out_of_service: '#8a94a3',
};

const TYPE_LETTERS: Record<ResourceType, string> = {
  ambulance: 'A',
  personnel: 'T',
  supply_truck: 'S',
  shelter: 'H',
};

/** Small square marker with a letter for the unit type, coloured by status. */
export function unitIcon(resource: Resource): L.DivIcon {
  const shelterClass = resource.type === 'shelter' ? ' is-shelter' : '';
  return L.divIcon({
    className: '',
    html: `<div class="unit-marker${shelterClass}" style="background:${STATUS_COLORS[resource.status]}">${TYPE_LETTERS[resource.type]}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Classic map pin, used when choosing a location for a new report. */
export const pinIcon = L.divIcon({
  className: '',
  html: '<div class="pin-marker"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 22],
});

export const CHENNAI_CENTER: [number, number] = [13.04, 80.225];
