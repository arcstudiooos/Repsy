import type { CheckinAnswers, CheckinQuestion } from '@kinetic/core';
import { metricDef, metricFromCanonical, metricUnit } from '@kinetic/core/metric-catalog';
import type { Units } from '@kinetic/core/units';

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

/** One answer as shown to people (PRD F3 types included); `fallback` when unanswered. */
export function formatAnswer(
  q: CheckinQuestion | undefined,
  v: CheckinAnswers[string] | undefined,
  units: Units,
  fallback: string,
): string {
  if (v === undefined || !q) return fallback;
  switch (q.type) {
    case 'yes_no':
      return v ? 'Yes' : 'No';
    case 'scale_1_5':
      return `${v} of 5`;
    case 'number':
      return q.unit ? `${v} ${q.unit}` : String(v);
    case 'multi_choice':
      return Array.isArray(v) ? v.join(', ') : String(v);
    case 'date':
      return typeof v === 'string' ? fmtDate(v) : String(v);
    case 'metric': {
      if (!q.metric || typeof v !== 'number') return String(v);
      const def = metricDef(q.metric);
      return `${metricFromCanonical(def.kind, v, units)} ${metricUnit(def.kind, units)}`;
    }
    default:
      return String(v);
  }
}
