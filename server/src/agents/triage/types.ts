import type { IncidentType } from '../../domain';

/** What the Triage Agent produces for one report. */
export interface Classification {
  type: IncidentType;
  severity: number; // 1 (minor) .. 5 (critical)
  confidence: number; // 0 .. 1, how sure the classifier is
  title: string; // short headline, e.g. "Flooded street, people stranded"
  reason: string; // plain-language explanation of the decision
}

export interface TriageResult extends Classification {
  method: 'ai' | 'rules';
  needsReview: boolean;
}
