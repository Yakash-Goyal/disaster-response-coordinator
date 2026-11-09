import type { ResourceStatus } from '../api/types';
import { RESOURCE_STATUS_LABELS, SEVERITY_LABELS } from '../lib/labels';

export function SeverityBadge({ severity }: { severity: number }) {
  return <span className={`badge badge-sev sev-${severity}`}>{SEVERITY_LABELS[severity]}</span>;
}

export function StatusBadge({ status }: { status: ResourceStatus }) {
  return <span className={`badge badge-dot st-${status}`}>{RESOURCE_STATUS_LABELS[status]}</span>;
}

export function ReviewBadge() {
  return (
    <span className="badge badge-review" title="The automatic classification is uncertain. Please check it.">
      Needs checking
    </span>
  );
}
