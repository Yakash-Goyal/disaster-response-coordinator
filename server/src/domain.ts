/**
 * Shared vocabulary of the system: the allowed values for roles, types and
 * statuses. These lists match the CHECK constraints in the database schema.
 */

export const USER_ROLES = ['commander', 'responder', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RESOURCE_TYPES = ['ambulance', 'supply_truck', 'personnel', 'shelter'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_STATUSES = ['available', 'en_route', 'on_scene', 'out_of_service'] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const INCIDENT_TYPES = [
  'flood',
  'fire',
  'structural_collapse',
  'medical',
  'road_blockage',
  'power_outage',
  'supply_shortage',
  'other',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['open', 'dispatched', 'on_scene', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const REPORT_SOURCES = ['manual', 'social_media', 'weather_api'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** Capabilities a resource can carry. Used by the Dispatch Agent for matching. */
export const CAPABILITIES = [
  'advanced_life_support',
  'trauma_kit',
  'water_rescue',
  'fire_fighting',
  'search_and_rescue',
  'heavy_equipment',
  'electrical_repair',
  'food_and_water',
  'medical_supplies',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Severity scale used everywhere (1 = minor ... 5 = critical). */
export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor',
  2: 'Moderate',
  3: 'Serious',
  4: 'Severe',
  5: 'Critical',
};

/** Human-friendly names, used when the agents write explanations. */
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

export const CAPABILITY_LABELS: Record<Capability, string> = {
  advanced_life_support: 'advanced life support',
  trauma_kit: 'trauma kit',
  water_rescue: 'water rescue boat',
  fire_fighting: 'fire-fighting equipment',
  search_and_rescue: 'search and rescue gear',
  heavy_equipment: 'heavy equipment',
  electrical_repair: 'electrical repair kit',
  food_and_water: 'food and water',
  medical_supplies: 'medical supplies',
};
