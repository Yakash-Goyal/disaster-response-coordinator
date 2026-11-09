/**
 * Shapes of the data the API returns. They mirror the server's types
 * (server/src/domain.ts and the *.service.ts files).
 */

export type UserRole = 'commander' | 'responder' | 'admin';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  resourceId: number | null;
}

export type ResourceType = 'ambulance' | 'supply_truck' | 'personnel' | 'shelter';
export type ResourceStatus = 'available' | 'en_route' | 'on_scene' | 'out_of_service';

export interface Resource {
  id: number;
  code: string;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
  lat: number;
  lng: number;
  homeBase: string;
  capacity: number;
  currentLoad: number;
  capabilities: string[];
  assignedIncidentId: number | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IncidentType =
  | 'flood'
  | 'fire'
  | 'structural_collapse'
  | 'medical'
  | 'road_blockage'
  | 'power_outage'
  | 'supply_shortage'
  | 'other';

export type IncidentStatus = 'open' | 'dispatched' | 'on_scene' | 'resolved';

export interface AssignedUnit {
  id: number;
  code: string;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
}

export interface Incident {
  id: number;
  title: string;
  type: IncidentType;
  severity: number;
  urgencyScore: number;
  urgencyReason: string;
  status: IncidentStatus;
  lat: number;
  lng: number;
  address: string | null;
  reportCount: number;
  confidence: number;
  needsReview: boolean;
  classifiedBy: 'ai' | 'rules' | 'commander';
  triageReason: string;
  createdAt: string;
  updatedAt: string;
  lastReportAt: string;
  dispatchedAt: string | null;
  resolvedAt: string | null;
  assignedUnits: AssignedUnit[];
  pendingDecisionId: number | null;
}

export type ReportSource = 'manual' | 'social_media' | 'weather_api';

export interface Report {
  id: number;
  source: ReportSource;
  text: string;
  address: string | null;
  reporter: string | null;
  imageUrl: string | null;
  reportedAt: string;
  lat: number;
  lng: number;
}

export interface HistoryEntry {
  id: number;
  actorType: 'agent' | 'human' | 'system';
  actorName: string;
  action: string;
  summary: string;
  createdAt: string;
}

export interface Candidate {
  resourceId: number;
  code: string;
  name: string;
  type: ResourceType;
  lat: number;
  lng: number;
  straightLineMeters: number;
  etaSeconds: number;
  roadMeters: number;
  etaSource: 'osrm' | 'estimate';
  matchedCapabilities: string[];
  missingCapabilities: string[];
  loadRatio: number;
  score: number;
}

export interface DispatchDecision {
  id: number;
  incidentId: number;
  recommendedResourceId: number;
  resourceId: number | null;
  recommendation: { requirement: { types: ResourceType[]; capabilities: string[] }; candidates: Candidate[] };
  rationale: string;
  humanAction: 'pending' | 'accepted' | 'overridden' | 'superseded';
  overrideReason: string | null;
  decidedByName: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface FeedStatus {
  running: boolean;
  posted: number;
  total: number;
  intervalSeconds: number;
}

export interface Route {
  durationSeconds: number;
  distanceMeters: number;
  source: 'osrm' | 'estimate';
  path: [number, number][];
}
