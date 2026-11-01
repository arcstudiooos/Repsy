'use client';

import type { CheckinQuestion } from '@kinetic/core';
import {
  OPS_FOR,
  type ConditionOp,
  type QuestionCondition,
} from '@kinetic/core/checkin-conditions';
import { Input } from '@/components/ui/input';

const SELECT =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const OP_LABEL: Record<ConditionOp, string> = {
  lte: 'is at most',
  gte: 'is at least',
  eq: 'is',
  includes: 'includes',
};

/** A sensible starting value for a condition on `subject`. */
function firstValue(subject: CheckinQuestion): QuestionCondition['value'] {
  if (subject.type === 'yes_no') return true;
  if (subject.type === 'single_choice' || subject.type === 'multi_choice') {
    return subject.options?.find((o) => o.trim() !== '') ?? '';
  }
  return subject.type === 'scale_1_5' ? 2 : 0;
}

/** PRD F11: "Show this question only if" an earlier answer matches. */
export function ConditionEditor({
  index,
  questions,
  value,
  onChange,
  error,
  uid,
}: {
  index: number;
  questions: CheckinQuestion[];
  value: QuestionCondition | undefined;
  onChange: (c: QuestionCondition | undefined) => void;
  error?: string;
  uid: string;
}) {
  const earlier = questions.slice(0, index).filter((q) => OPS_FOR[q.type]);
  if (earlier.length === 0) return null;
  const subject = earlier.find((q) => q.id === value?.questionId);
  const n = index + 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
          <label htmlFor={`${uid}-if`} className="text-sm font-medium">
            Question {n}: show
          </label>
          <select
            id={`${uid}-if`}
            value={value?.questionId ?? ''}
            onChange={(e) => {
              const q = earlier.find((x) => x.id === e.target.value);
              onChange(
                q
                  ? { questionId: q.id, op: OPS_FOR[q.type]![0]!, value: firstValue(q) }
                  : undefined,
              );
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-if-err` : undefined}
            className={`${SELECT} w-full max-w-full sm:max-w-sm`}
          >
            <option value="">Always</option>
            {earlier.map((q) => (
              <option key={q.id} value={q.id}>
                Only if “{q.label.slice(0, 50)}”
              </option>
            ))}
          </select>
        </div>
        {value && subject && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-op`} className="text-sm font-medium">
                Question {n} comparison
              </label>
              <select
                id={`${uid}-op`}
                value={value.op}
                onChange={(e) => onChange({ ...value, op: e.target.value as ConditionOp })}
                className={SELECT}
              >
                {OPS_FOR[subject.type]!.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${uid}-value`} className="text-sm font-medium">
                Question {n} matching answer
              </label>
              {subject.type === 'yes_no' ? (
                <select
                  id={`${uid}-value`}
                  value={value.value ? 'yes' : 'no'}
                  onChange={(e) => onChange({ ...value, value: e.target.value === 'yes' })}
                  className={SELECT}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : subject.type === 'single_choice' || subject.type === 'multi_choice' ? (
                <select
                  id={`${uid}-value`}
                  value={String(value.value)}
                  onChange={(e) => onChange({ ...value, value: e.target.value })}
                  className={SELECT}
                >
                  {(subject.options ?? [])
                    .filter((o) => o.trim() !== '')
                    .map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                </select>
              ) : (
                <Input
                  id={`${uid}-value`}
                  type="number"
                  inputMode="decimal"
                  className="w-28"
                  value={String(value.value)}
                  onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
                />
              )}
            </div>
          </>
        )}
      </div>
      {error && (
        <p id={`${uid}-if-err`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
