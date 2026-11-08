import type { CheckinWeekSummary, Units } from '@repsy/core';
import { metricDef, metricFromCanonical, metricUnit } from '@repsy/core/metric-catalog';
import { formatDate } from '@/app/app/clients/StatusBadge';
import { plural } from '@/lib/session-format';

/** The week's facts beside a check-in (PRD F8), from what is already logged. */
export function WeekSummary({
  summary,
  units,
  heading,
}: {
  summary: CheckinWeekSummary;
  units: Units;
  heading: string;
}) {
  const w = summary.workouts;
  return (
    <section aria-label={heading} className="text-sm">
      <h4 className="mb-1 font-semibold">{heading}</h4>
      <p className="text-secondary">
        {formatDate(summary.fromLocalDate)} to {formatDate(summary.toLocalDate)}
      </p>
      <ul className="flex flex-col gap-0.5">
        {w.planned === 0 ? (
          <li>No workouts scheduled.</li>
        ) : (
          <>
            <li>
              {w.completed} of {plural(w.planned, 'workout', 'workouts')} completed
            </li>
            <li>{w.skipped} skipped</li>
            <li>{w.missed} missed</li>
          </>
        )}
        {summary.personalRecords.length > 0 && (
          <li>Personal records: {summary.personalRecords.map((r) => r.name).join(', ')}</li>
        )}
        {summary.metrics.map((m) => {
          const def = metricDef(m.metric);
          const show = (v: number) => metricFromCanonical(def.kind, v, units);
          const unit = metricUnit(def.kind, units);
          const change =
            m.change === null
              ? null
              : Math.round((show(m.value) - show(m.value - m.change)) * 10) / 10;
          return (
            <li key={m.metric}>
              {def.label}: {show(m.value)} {unit}
              {change !== null && ` (${change > 0 ? '+' : ''}${change})`}
            </li>
          );
        })}
        {summary.habits && (
          <li>
            Habits: {summary.habits.done} of {plural(summary.habits.expected, 'day', 'days')} done
          </li>
        )}
        {summary.nutrition && (
          <li>
            Nutrition on target: {summary.nutrition.onTarget} of{' '}
            {plural(summary.nutrition.logged, 'logged day', 'logged days')}
          </li>
        )}
      </ul>
    </section>
  );
}
