import type {
  IncidentStatus,
  IncidentType,
  ReportSource,
  ResourceStatus,
  ResourceType,
  UserRole,
} from '../api/types';

/** Everyday words for every code value, so the screens never show raw codes. */

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  flood: 'Flooding',
  fire: 'Fire',
  structural_collapse: 'Building collapse',
  medical: 'Medical emergency',
  road_blockage: 'Road blocked',
  power_outage: 'Power outage',
  supply_shortage: 'Food / water shortage',
  other: 'Other',
};

export const INCIDENT_TYPES = Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Waiting for a unit',
  dispatched: 'Unit on the way',
  on_scene: 'Unit on scene',
  resolved: 'Resolved',
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor',
  2: 'Moderate',
  3: 'Serious',
  4: 'Severe',
  5: 'Critical',
};

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  ambulance: 'Ambulance',
  supply_truck: 'Supply truck',
  personnel: 'Response team',
  shelter: 'Shelter',
};

export const RESOURCE_TYPE_PLURALS: Record<ResourceType, string> = {
  ambulance: 'Ambulances',
  supply_truck: 'Supply trucks',
  personnel: 'Response teams',
  shelter: 'Shelters',
};

export const RESOURCE_TYPES = Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[];

export const RESOURCE_STATUS_LABELS: Record<ResourceStatus, string> = {
  available: 'Available',
  en_route: 'On the way',
  on_scene: 'On scene',
  out_of_service: 'Out of service',
};

export const RESOURCE_STATUSES = Object.keys(RESOURCE_STATUS_LABELS) as ResourceStatus[];

export const CAPABILITY_LABELS: Record<string, string> = {
  advanced_life_support: 'Advanced life support',
  trauma_kit: 'Trauma kit',
  water_rescue: 'Water rescue boat',
  fire_fighting: 'Fire-fighting',
  search_and_rescue: 'Search & rescue',
  heavy_equipment: 'Heavy equipment',
  electrical_repair: 'Electrical repair',
  food_and_water: 'Food & water',
  medical_supplies: 'Medical supplies',
};

export const CAPABILITIES = Object.keys(CAPABILITY_LABELS);

export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  manual: 'Phone / walk-in',
  social_media: 'Social media',
  weather_api: 'Weather alert',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  commander: 'Commander',
  responder: 'Field responder',
  admin: 'Administrator',
};

/** The first page each role sees after logging in. */
export function homePathFor(role: UserRole): string {
  if (role === 'admin') return '/resources';
  if (role === 'responder') return '/responder';
  return '/';
}
