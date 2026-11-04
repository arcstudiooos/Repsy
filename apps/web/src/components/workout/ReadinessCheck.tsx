'use client';

import { useId } from 'react';
import { READINESS_QUESTIONS, type ReadinessKey } from '@kinetic/core/readiness';

export type ReadinessDraft = Partial<Record<ReadinessKey, number>>;

/** PRD D17: five optional 1-5 questions before Start. Sent with Start once all five are answered. */
export function ReadinessCheck({
  value,
  onChange,
}: {
  value: ReadinessDraft;
  onChange: (next: ReadinessDraft) => void;
}) {
  const id = useId();
  return (
    <details className="mb-4 rounded-card bg-surface p-4 shadow-card">
      <summary className="min-h-11 cursor-pointer py-2 font-medium text-accent">
        How are you today? (optional)
      </summary>
      <p className="mb-3 text-sm text-secondary">
        Five quick questions for your coach. 5 is the best answer each time.
      </p>
      <div className="flex flex-col gap-4">
        {READINESS_QUESTIONS.map((q) => (
          <fieldset key={q.key} aria-describedby={`${id}-${q.key}-scale`}>
            <legend className="mb-1 font-medium">{q.label}</legend>
            <p id={`${id}-${q.key}-scale`} className="mb-1 text-sm text-secondary">
              1 {q.low} · 5 {q.high}
            </p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border border-input-border has-checked:border-accent has-checked:bg-accent-fill has-checked:text-on-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${id}-${q.key}`}
                    value={n}
                    checked={value[q.key] === n}
                    onChange={() => onChange({ ...value, [q.key]: n })}
                  />
                  {n}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </details>
  );
}
