import type { Capability, IncidentType, ResourceType } from '../../domain';

/**
 * What kind of unit each incident type needs.
 * `types`        - resource types that can respond
 * `capabilities` - equipment the ideal unit carries (missing ones are
 *                  allowed but penalised, so a capable unit is preferred)
 */
export interface Requirement {
  types: ResourceType[];
  capabilities: Capability[];
}

export function requirementFor(type: IncidentType, severity: number): Requirement {
  switch (type) {
    case 'medical':
      return { types: ['ambulance'], capabilities: severity >= 4 ? ['advanced_life_support'] : [] };
    case 'fire':
      return { types: ['personnel'], capabilities: ['fire_fighting'] };
    case 'flood':
      return { types: ['personnel'], capabilities: ['water_rescue'] };
    case 'structural_collapse':
      return { types: ['personnel'], capabilities: ['search_and_rescue'] };
    case 'road_blockage':
      return { types: ['personnel'], capabilities: ['heavy_equipment'] };
    case 'power_outage':
      return { types: ['personnel'], capabilities: ['electrical_repair'] };
    case 'supply_shortage':
      return { types: ['supply_truck'], capabilities: ['food_and_water'] };
    case 'other':
      return { types: ['personnel', 'ambulance'], capabilities: [] };
  }
}
