import type { AdherenceCounts, ComplianceWindow } from '@repsy/core';

export const WINDOW_LABEL: Record<ComplianceWindow, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
};

/**
 * One adherence figure with its numerator and denominator (D-008 clar. 1). A zero denominator reads
 * "No sessions due yet", never 0%.
 */
export function CompliancePercent({ counts }: { counts: AdherenceCounts }) {
  if (counts.eligible === 0) {
    return (
      <span className="text-secondary">
        <span aria-hidden="true">–</span>
        <span className="sr-only">No sessions due yet</span>
      </span>
    );
  }
  const pct = Math.round((counts.completed / counts.eligible) * 100);
  return (
    <span className="whitespace-nowrap">
      {pct}%{' '}
      <span className="text-sm text-secondary">
        <span aria-hidden="true">
          {counts.completed}/{counts.eligible}
        </span>
        <span className="sr-only">
          ({counts.completed} of {counts.eligible} completed)
        </span>
      </span>
    </span>
  );
}
