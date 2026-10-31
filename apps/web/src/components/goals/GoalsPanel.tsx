'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { GoalKind, GoalLabel, GoalView } from '@kinetic/core';
import {
  BODY_METRICS,
  metricDef,
  metricFromCanonical,
  metricToCanonical,
  metricUnit,
  type BodyMetric,
} from '@kinetic/core/metric-catalog';
import { fromDisplay, toDisplay, type Units } from '@kinetic/core/units';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { cn } from '@/lib/utils';

const LABEL: Record<GoalLabel, string> = {
  achieved: 'Achieved',
  on_track: 'On track',
  behind: 'Behind',
  no_data: 'No data yet',
};
// Status reads from the words; the colour only repeats it.
const TONE: Record<GoalLabel, string> = {
  achieved: 'bg-accent text-white',
  on_track: 'bg-canvas text-ink',
  behind: 'bg-canvas text-ink ring-1 ring-warning',
  no_data: 'bg-canvas text-secondary',
};

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

function show(g: Pick<GoalView, 'kind' | 'metric'>, v: number, units: Units): string {
  if (g.kind === 'habit') return `${Math.round(v)}%`;
  if (g.kind === 'metric' && g.metric) {
    const def = metricDef(g.metric);
    return `${metricFromCanonical(def.kind, v, units)} ${metricUnit(def.kind, units)}`;
  }
  return `${toDisplay(v, units)} ${units}`;
}

export interface GoalsPanelProps {
  clientId: string;
  goals: GoalView[];
  units: Units;
  /** Coaches set and archive goals; clients see them. */
  canEdit: boolean;
  /** Exercises the client has lifted, for exercise goals. */
  exercises?: { id: string; name: string }[];
  habits?: { id: string; title: string }[];
}

/** Goals with progress toward them (PRD B18, E9). */
export function GoalsPanel({
  clientId,
  goals,
  units,
  canEdit,
  exercises = [],
  habits = [],
}: GoalsPanelProps) {
  const router = useRouter();
  const active = goals.filter((g) => g.status === 'active');
  const archived = goals.filter((g) => g.status === 'archived');

  async function setStatus(g: GoalView, status: 'active' | 'archived') {
    const res = await call('PATCH', `/api/v1/goals/${encodeURIComponent(g.id)}`, { status });
    if (!res.ok) {
      toast.error(res.fieldErrors?.status?.[0] ?? res.message);
      return;
    }
    router.refresh();
  }

  const item = (g: GoalView) => (
    <li key={g.id} className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium break-words">{g.title}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-sm font-medium', TONE[g.label])}>
          {LABEL[g.label]}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-label={`${g.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={g.progress === null ? undefined : Math.round(g.progress * 100)}
        aria-valuetext={g.progress === null ? 'No data yet' : `${Math.round(g.progress * 100)}%`}
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.round((g.progress ?? 0) * 100)}%` }}
        />
      </div>
      <p className="text-sm text-secondary">
        {show(g, g.startValue, units)} → {show(g, g.targetValue, units)} by {fmtDate(g.targetDate)}
        {g.currentValue !== null && ` · now ${show(g, g.currentValue, units)}`}
      </p>
      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          onClick={() => void setStatus(g, g.status === 'active' ? 'archived' : 'active')}
          aria-label={`${g.status === 'active' ? 'Archive' : 'Restore'} goal: ${g.title}`}
        >
          {g.status === 'active' ? 'Archive' : 'Restore'}
        </Button>
      )}
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Goals</CardTitle>
        <CardDescription>
          Progress comes from what is already recorded: measurements, logged lifts and habits.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active.length === 0 ? (
          <p className="text-secondary">
            {canEdit ? 'No goals yet. Add one below.' : 'Your coach has not set goals yet.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider" aria-label="Active goals">
            {active.map(item)}
          </ul>
        )}
        {archived.length > 0 && (
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
              Archived ({archived.length})
            </summary>
            <ul className="flex flex-col divide-y divide-divider">{archived.map(item)}</ul>
          </details>
        )}
        {canEdit && (
          <NewGoalForm clientId={clientId} units={units} exercises={exercises} habits={habits} />
        )}
      </CardContent>
    </Card>
  );
}

function NewGoalForm({
  clientId,
  units,
  exercises,
  habits,
}: {
  clientId: string;
  units: Units;
  exercises: { id: string; name: string }[];
  habits: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<GoalKind>('metric');
  const [metric, setMetric] = useState<BodyMetric>('weight');
  const [exerciseId, setExerciseId] = useState(exercises[0]?.id ?? '');
  const [measure, setMeasure] = useState<'e1rm' | 'heaviest'>('e1rm');
  const [habitId, setHabitId] = useState(habits[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [start, setStart] = useState('');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const unit =
    kind === 'habit' ? '%' : kind === 'metric' ? metricUnit(metricDef(metric).kind, units) : units;
  const toCanonical = (v: number) =>
    kind === 'habit'
      ? v
      : kind === 'metric'
        ? metricToCanonical(metricDef(metric).kind, v, units)
        : fromDisplay(v, units);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const t = Number(target);
    if (target.trim() === '' || !Number.isFinite(t)) {
      setErrors({ targetValue: 'Enter a target.' });
      return;
    }
    setBusy(true);
    const res = await call('POST', `/api/v1/clients/${encodeURIComponent(clientId)}/goals`, {
      kind,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(kind === 'metric' ? { metric } : {}),
      ...(kind === 'exercise' ? { exerciseId, exerciseMeasure: measure } : {}),
      ...(kind === 'habit' ? { habitId } : {}),
      targetValue: toCanonical(t),
      ...(start.trim() !== '' && Number.isFinite(Number(start))
        ? { startValue: toCanonical(Number(start)) }
        : {}),
      targetDate: date,
    });
    setBusy(false);
    if (!res.ok) {
      const fe = res.fieldErrors ?? {};
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
      if (Object.keys(fe).length === 0) toast.error(res.message);
      return;
    }
    toast.success('Goal added.');
    setTarget('');
    setStart('');
    setTitle('');
    router.refresh();
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${id}-${k}-err`} className="text-sm text-danger">
        {errors[k]}
      </p>
    ) : null;
  const described = (k: string) => (errors[k] ? `${id}-${k}-err` : undefined);
  const selectClass =
    'min-h-11 rounded-control border border-input-border bg-surface px-3 text-base';

  return (
    <form
      onSubmit={submit}
      aria-label="Add a goal"
      noValidate
      className="grid gap-3 border-t border-divider pt-4 sm:grid-cols-2"
    >
      <h3 className="font-semibold sm:col-span-2">Add a goal</h3>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-kind`} className="text-sm font-medium">
          Tracks
        </label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as GoalKind)}
          className={selectClass}
        >
          <option value="metric">A measurement</option>
          <option value="exercise" disabled={exercises.length === 0}>
            A lift{exercises.length === 0 ? ' (log one first)' : ''}
          </option>
          <option value="habit" disabled={habits.length === 0}>
            A habit{habits.length === 0 ? ' (add one first)' : ''}
          </option>
        </select>
      </div>
      {kind === 'metric' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-metric`} className="text-sm font-medium">
            Measurement
          </label>
          <select
            id={`${id}-metric`}
            value={metric}
            onChange={(e) => setMetric(e.target.value as BodyMetric)}
            className={selectClass}
          >
            {BODY_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {kind === 'exercise' && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-ex`} className="text-sm font-medium">
              Exercise
            </label>
            <select
              id={`${id}-ex`}
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
              className={selectClass}
            >
              {exercises.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-measure`} className="text-sm font-medium">
              Measure
            </label>
            <select
              id={`${id}-measure`}
              value={measure}
              onChange={(e) => setMeasure(e.target.value as 'e1rm' | 'heaviest')}
              className={selectClass}
            >
              <option value="e1rm">Estimated 1RM</option>
              <option value="heaviest">Heaviest set</option>
            </select>
          </div>
        </>
      )}
      {kind === 'habit' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-habit`} className="text-sm font-medium">
            Habit
          </label>
          <select
            id={`${id}-habit`}
            value={habitId}
            onChange={(e) => setHabitId(e.target.value)}
            className={selectClass}
          >
            {habits.map((h) => (
              <option key={h.id} value={h.id}>
                {h.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-target`} className="text-sm font-medium">
          Target ({unit})
        </label>
        <Input
          id={`${id}-target`}
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-invalid={errors.targetValue ? true : undefined}
          aria-describedby={described('targetValue')}
        />
        {err('targetValue')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-start`} className="text-sm font-medium">
          Starting value ({unit}, optional)
        </label>
        <Input
          id={`${id}-start`}
          inputMode="decimal"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-invalid={errors.startValue ? true : undefined}
          aria-describedby={described('startValue')}
        />
        {err('startValue')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-date`} className="text-sm font-medium">
          Target date
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={errors.targetDate ? true : undefined}
          aria-describedby={described('targetDate')}
          className="min-h-11 rounded-control border border-input-border bg-surface px-3"
        />
        {err('targetDate')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Name (optional)
        </label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {(errors.kind || errors.metric || errors.exerciseId || errors.habitId) && (
        <p role="alert" className="text-danger sm:col-span-2">
          {errors.kind || errors.metric || errors.exerciseId || errors.habitId}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add goal'}
        </Button>
      </div>
    </form>
  );
}
