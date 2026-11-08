'use client';

import { useId, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import {
  describeRule,
  progressSets,
  validRule,
  type ProgressionRule,
} from '@repsy/core/progression';
import type { Units } from '@repsy/core/units';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { EditorSet, EditorValues } from './editorSchema';

const PATH = /^weeks\.(\d+)\.days\.(\d+)\.exercises\.(\d+)$/;
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/**
 * PRD C12: fill this exercise's later weeks from this week's sets with a rule, after a week-by-week preview. Applies
 * to the same exercise on the same day of each later week; weeks without it are left alone.
 */
export function ProgressionDialog({
  base,
  name,
  units,
}: {
  base: string;
  name: string;
  units: Units;
}) {
  const id = useId();
  const { getValues, setValue } = useFormContext<EditorValues>();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'load' | 'reps'>('load');
  const [step, setStep] = useState(units === 'kg' ? '2.5' : '5');
  const [maxReps, setMaxReps] = useState('12');
  const [loadStep, setLoadStep] = useState(units === 'kg' ? '2.5' : '5');
  const [rpeMax, setRpeMax] = useState('8');
  const m = PATH.exec(base);
  if (!m) return null;
  const [w, d, e] = [Number(m[1]), Number(m[2]), Number(m[3])];

  const rule: ProgressionRule =
    kind === 'load'
      ? { kind, step: num(step) ?? 0, ...(num(rpeMax) ? { rpeMax: num(rpeMax) } : {}) }
      : {
          kind,
          step: num(step) ?? 0,
          maxReps: num(maxReps) ?? 0,
          loadStep: num(loadStep) ?? 0,
          ...(num(rpeMax) ? { rpeMax: num(rpeMax) } : {}),
        };
  const error = validRule(rule);

  // Later weeks with the same exercise on the same day.
  const targets = () => {
    const values = getValues();
    const exerciseId = values.weeks[w]?.days[d]?.exercises[e]?.exerciseId;
    const out: { week: number; index: number }[] = [];
    values.weeks.forEach((week, wi) => {
      if (wi <= w) return;
      const index = week.days[d]?.exercises.findIndex((x) => x.exerciseId === exerciseId) ?? -1;
      if (index >= 0) out.push({ week: wi, index });
    });
    return out;
  };
  const baseSets = () => (getValues(`${base}.sets` as never) as unknown as EditorSet[]) ?? [];
  const preview = open && !error ? targets() : [];
  const fmt = (s: { reps?: number; loadKg?: number; rpe?: number }) =>
    [
      s.reps !== undefined ? `${s.reps}` : null,
      s.loadKg !== undefined ? `${s.loadKg} ${units}` : null,
    ]
      .filter(Boolean)
      .join(' × ') + (s.rpe ? ` @ RPE ${s.rpe}` : '');

  function apply() {
    const sets = baseSets();
    for (const t of targets()) {
      const progressed = progressSets(sets, rule, t.week - w);
      setValue(
        `weeks.${t.week}.days.${d}.exercises.${t.index}.sets` as never,
        sets.map((s, i) => ({ ...s, ...progressed[i] })) as never,
        { shouldDirty: true },
      );
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Progress ${name} over weeks`}>
          Progress
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Progress {name} over weeks</DialogTitle>
          <DialogDescription>
            Fills the later weeks from week {w + 1}&apos;s sets. Check the preview, then apply;
            nothing is saved until you save the program.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Rule</legend>
            {(
              [
                ['load', 'Add load each week'],
                ['reps', 'Add reps each week, then load'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  className="size-5"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-step`} className="text-sm font-medium">
                {kind === 'load' ? `Load per week (${units})` : 'Reps per week'}
              </label>
              <Input
                id={`${id}-step`}
                inputMode="decimal"
                className="w-24"
                value={step}
                onChange={(x) => setStep(x.target.value)}
              />
            </div>
            {kind === 'reps' && (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-max`} className="text-sm font-medium">
                    Up to reps
                  </label>
                  <Input
                    id={`${id}-max`}
                    inputMode="numeric"
                    className="w-24"
                    value={maxReps}
                    onChange={(x) => setMaxReps(x.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${id}-load`} className="text-sm font-medium">
                    Then load ({units})
                  </label>
                  <Input
                    id={`${id}-load`}
                    inputMode="decimal"
                    className="w-24"
                    value={loadStep}
                    onChange={(x) => setLoadStep(x.target.value)}
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-rpe`} className="text-sm font-medium">
                Target RPE (optional)
              </label>
              <Input
                id={`${id}-rpe`}
                inputMode="decimal"
                className="w-24"
                value={rpeMax}
                onChange={(x) => setRpeMax(x.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : (
            <p className="text-sm text-secondary">{describeRule(rule, units)}</p>
          )}
          {!error &&
            (preview.length === 0 ? (
              <p className="text-secondary">
                No later week has {name} on this day. Duplicate the week first.
              </p>
            ) : (
              <ol aria-label="Preview" className="flex flex-col gap-1 text-sm">
                {preview.map((t) => (
                  <li key={t.week}>
                    <span className="font-medium">Week {t.week + 1}:</span>{' '}
                    {progressSets(baseSets(), rule, t.week - w)
                      .map(fmt)
                      .join(', ')}
                  </li>
                ))}
              </ol>
            ))}
          <div className="flex gap-2">
            <Button type="button" disabled={Boolean(error) || preview.length === 0} onClick={apply}>
              Apply to {preview.length} {preview.length === 1 ? 'week' : 'weeks'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
