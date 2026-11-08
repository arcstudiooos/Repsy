'use client';

import { useId, useState } from 'react';
import type { CheckinAnswers, CheckinQuestion, MetricAsOf, Units } from '@repsy/core';
import { metricDef, metricFromCanonical, metricUnit } from '@repsy/core/metric-catalog';
import { formatAnswer } from '@/lib/checkin-answer';

export interface CompareCheckin {
  id: string;
  periodLocalDate: string;
  questions: CheckinQuestion[];
  answers: CheckinAnswers;
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

/**
 * A check-in beside any earlier one (PRD F6): answers question by question (matched by id, then by label, so an
 * edited template still lines up), the change on 1-5 scales, and how measurements moved between the two dates.
 */
export function CheckinCompare({
  current,
  earlier,
  metricsAt,
  units,
}: {
  current: CompareCheckin;
  /** Earlier sent check-ins, newest first. */
  earlier: CompareCheckin[];
  metricsAt: Record<string, MetricAsOf[]>;
  units: Units;
}) {
  const id = useId();
  const [otherId, setOtherId] = useState(earlier[0]?.id ?? '');
  const other = earlier.find((c) => c.id === otherId);
  if (earlier.length === 0) return null;

  const match = (q: CheckinQuestion) =>
    other?.questions.find((o) => o.id === q.id) ??
    other?.questions.find((o) => o.label === q.label);
  const nowMetrics = metricsAt[current.periodLocalDate] ?? [];
  const thenMetrics = other ? (metricsAt[other.periodLocalDate] ?? []) : [];

  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent">
        Compare with an earlier check-in
      </summary>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <label htmlFor={`${id}-other`} className="font-medium">
            Earlier check-in
          </label>
          <select
            id={`${id}-other`}
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
          >
            {earlier.map((c) => (
              <option key={c.id} value={c.id}>
                Week of {fmtDate(c.periodLocalDate)}
              </option>
            ))}
          </select>
        </div>
        {other && (
          <div role="region" aria-labelledby={`${id}-cap`} tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-left">
              <caption id={`${id}-cap`} className="sr-only">
                Week of {fmtDate(current.periodLocalDate)} compared with week of{' '}
                {fmtDate(other.periodLocalDate)}
              </caption>
              <thead className="border-b border-divider text-secondary">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Question
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {fmtDate(current.periodLocalDate)}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {fmtDate(other.periodLocalDate)}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.questions.map((q) => {
                  const o = match(q);
                  const a = current.answers[q.id];
                  const b = o ? other.answers[o.id] : undefined;
                  const delta =
                    q.type === 'scale_1_5' && typeof a === 'number' && typeof b === 'number'
                      ? a - b
                      : null;
                  return (
                    <tr key={q.id} className="border-b border-divider align-top last:border-0">
                      <th scope="row" className="py-2 pr-3 font-normal text-secondary">
                        {q.label}
                      </th>
                      <td className="py-2 pr-3 break-words whitespace-pre-line">
                        {formatAnswer(q, a, units, '–')}
                      </td>
                      <td className="py-2 pr-3 break-words whitespace-pre-line">
                        {formatAnswer(o, b, units, '–')}
                      </td>
                      <td className="py-2">
                        {delta === null ? '–' : delta > 0 ? `+${delta}` : String(delta)}
                      </td>
                    </tr>
                  );
                })}
                {nowMetrics.map((m) => {
                  const then = thenMetrics.find((t) => t.metric === m.metric);
                  const def = metricDef(m.metric);
                  const v = (x: number) => metricFromCanonical(def.kind, x, units);
                  const unit = metricUnit(def.kind, units);
                  const delta = then ? Math.round((v(m.value) - v(then.value)) * 10) / 10 : null;
                  return (
                    <tr key={m.metric} className="border-b border-divider align-top last:border-0">
                      <th scope="row" className="py-2 pr-3 font-normal text-secondary">
                        {def.label}
                      </th>
                      <td className="py-2 pr-3">
                        {v(m.value)} {unit}
                      </td>
                      <td className="py-2 pr-3">{then ? `${v(then.value)} ${unit}` : '–'}</td>
                      <td className="py-2">
                        {delta === null ? '–' : `${delta > 0 ? '+' : ''}${delta} ${unit}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
