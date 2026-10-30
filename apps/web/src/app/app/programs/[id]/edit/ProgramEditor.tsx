'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  FormProvider,
  get,
  useFieldArray,
  useForm,
  useWatch,
  useFormContext,
  type FieldError,
  type FieldErrors,
} from 'react-hook-form';
import type { ExerciseView, ProgramDetail } from '@kinetic/core';
import type { TrackingType } from '@kinetic/core/exercise-options';
import type { Units } from '@kinetic/core/units';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExercisePicker } from './ExercisePicker';
import {
  buildEditorSchema,
  defaultSet,
  MAX_DAYS,
  MAX_WEEK_COUNT,
  newDay,
  toEditorValues,
  toWeekInputs,
  type EditorValues,
} from './editorSchema';

interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const numberField = (v: unknown) =>
  v === '' || v === null || v === undefined ? undefined : Number(v);

/** Error message at `path`, whether RHF stored it on the field or on an array's `root`. */
function useError(path: string): string | undefined {
  const {
    formState: { errors },
  } = useFormContext<EditorValues>();
  const e = get(errors as FieldErrors, path) as (FieldError & { root?: FieldError }) | undefined;
  return e?.message ?? e?.root?.message;
}

function NumberField({ path, label, step }: { path: string; label: string; step?: string }) {
  const { register } = useFormContext<EditorValues>();
  const id = useId();
  const error = useError(path);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...register(path as never, { setValueAs: numberField })}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function SetRows({
  base,
  trackingType,
  units,
}: {
  base: string;
  trackingType: TrackingType;
  units: Units;
}) {
  const { control, getValues } = useFormContext<EditorValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `${base}.sets` as never });
  const setsError = useError(`${base}.sets`);
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f, i) => (
        <div
          key={f.id}
          role="group"
          aria-label={`Set ${i + 1}`}
          className="flex items-end gap-2 rounded-control bg-canvas p-3"
        >
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-4">
            {trackingType === 'reps_load' && (
              <>
                <NumberField path={`${base}.sets.${i}.reps`} label="Reps" step="1" />
                <NumberField path={`${base}.sets.${i}.loadKg`} label={`Load (${units})`} />
                <NumberField path={`${base}.sets.${i}.rpe`} label="RPE" step="0.5" />
              </>
            )}
            {trackingType === 'duration' && (
              <NumberField path={`${base}.sets.${i}.durationSec`} label="Duration (s)" step="1" />
            )}
            {trackingType === 'distance' && (
              <NumberField path={`${base}.sets.${i}.distanceM`} label="Distance (m)" />
            )}
            <NumberField path={`${base}.sets.${i}.restSec`} label="Rest (s)" step="1" />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove set ${i + 1}`}
            disabled={fields.length <= 1}
            onClick={() => remove(i)}
          >
            <Trash2 aria-hidden className="size-5" />
          </Button>
        </div>
      ))}
      {setsError && <p className="text-sm text-danger">{setsError}</p>}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={fields.length >= 20}
          onClick={() => {
            const sets = getValues(`${base}.sets` as never) as unknown as unknown[];
            const last = sets[sets.length - 1];
            append((last ? structuredClone(last) : defaultSet(trackingType)) as never);
          }}
        >
          <Plus aria-hidden className="size-4" />
          Add set
        </Button>
      </div>
    </div>
  );
}

function DayCard({ week, day, units }: { week: number; day: number; units: Units }) {
  const { control, register, watch } = useFormContext<EditorValues>();
  const base = `weeks.${week}.days.${day}`;
  const exercises = useFieldArray({ control, name: `${base}.exercises` as never });
  const headingId = useId();
  const titleId = useId();
  const titleError = useError(`${base}.title`);
  const exercisesError = useError(`${base}.exercises`);

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
    >
      <h3 id={headingId} className="text-lg font-semibold">
        Day {day + 1}
      </h3>
      <div className="flex flex-col gap-1">
        <label htmlFor={titleId} className="text-sm font-medium">
          Day title
        </label>
        <Input
          id={titleId}
          maxLength={120}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? `${titleId}-error` : undefined}
          {...register(`weeks.${week}.days.${day}.title`)}
        />
        {titleError && (
          <p id={`${titleId}-error`} className="text-sm text-danger">
            {titleError}
          </p>
        )}
      </div>

      {exercises.fields.map((f, i) => {
        const name = watch(`weeks.${week}.days.${day}.exercises.${i}.exerciseName`);
        const trackingType = watch(`weeks.${week}.days.${day}.exercises.${i}.trackingType`);
        return (
          <ExerciseBlock
            key={f.id}
            base={`${base}.exercises.${i}`}
            name={name}
            trackingType={trackingType}
            units={units}
            onRemove={() => exercises.remove(i)}
          />
        );
      })}

      {exercisesError && <p className="text-sm text-danger">{exercisesError}</p>}
      <div>
        <ExercisePicker
          onPick={(e: ExerciseView) =>
            exercises.append({
              exerciseId: e.id,
              exerciseName: e.name,
              trackingType: e.trackingType,
              note: '',
              sets: [defaultSet(e.trackingType)],
            } as never)
          }
        />
      </div>
    </div>
  );
}

function ExerciseBlock({
  base,
  name,
  trackingType,
  units,
  onRemove,
}: {
  base: string;
  name: string;
  trackingType: TrackingType;
  units: Units;
  onRemove: () => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-divider p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className="text-base font-semibold">
          {name}
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      <SetRows base={base} trackingType={trackingType} units={units} />
    </div>
  );
}

export function ProgramEditor({ program, units }: { program: ProgramDetail; units: Units }) {
  const schema = useMemo(() => buildEditorSchema(units), [units]);
  const initial = useMemo(() => toEditorValues(program, units), [program, units]);
  const form = useForm<EditorValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
    mode: 'onSubmit',
  });
  const {
    control,
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { isSubmitting, errors },
  } = form;
  const weeks = useFieldArray({ control, name: 'weeks' });
  // RHF's own isDirty stays true after reset() once field arrays remount, so compare against the
  // last saved content instead.
  const serialize = (v: Pick<EditorValues, 'title' | 'weeks'>) =>
    JSON.stringify({ title: v.title, weeks: toWeekInputs(v as EditorValues, units) });
  const [savedSnapshot, setSavedSnapshot] = useState(() => serialize(initial));
  const watched = useWatch({ control }) as EditorValues;
  const isDirty = watched.weeks ? serialize(watched) !== savedSnapshot : false;
  const [versionNo, setVersionNo] = useState<number | null>(program.versionNo);
  const [activeWeek, setActiveWeek] = useState('0');
  const [conflict, setConflict] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<number | null>(null);
  const skipGuard = useRef(false);
  const titleId = useId();

  // Unsaved-changes guard: there is no autosave until Sprint 3.
  useEffect(() => {
    if (!isDirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      if (skipGuard.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [isDirty]);

  const daysPerWeek = weeks.fields[0] ? (getValues('weeks.0.days')?.length ?? 1) : 1;

  function setDays(next: number) {
    const clamped = Math.min(MAX_DAYS, Math.max(1, next));
    const current = getValues('weeks');
    weeks.replace(
      current.map((w) => {
        const days = w.days.slice(0, clamped);
        while (days.length < clamped) days.push(newDay(days.length + 1));
        return { days };
      }),
    );
  }

  function addWeek() {
    const current = getValues('weeks');
    const last = current[current.length - 1];
    weeks.append(structuredClone(last) as EditorValues['weeks'][number]);
    setActiveWeek(String(current.length));
  }

  function onInvalid() {
    setFormError('Some fields need attention. Fix them and save again.');
  }

  async function onSubmit(values: EditorValues) {
    setFormError(null);
    setConflict(false);
    setSavedAs(null);
    const body: Record<string, unknown> = {
      expectedVersion: versionNo,
      title: values.title,
      weeks: toWeekInputs(values, units),
    };
    try {
      const res = await fetch(`/api/v1/programs/${program.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const saved = ((await res.json()) as { data: ProgramDetail }).data;
        const next = toEditorValues(saved, units);
        reset(next);
        setSavedSnapshot(serialize(next));
        setVersionNo(saved.versionNo);
        setSavedAs(saved.versionNo);
        return;
      }
      const payload = (await res.json().catch(() => null)) as { error?: ApiError } | null;
      const error = payload?.error;
      if (res.status === 409) {
        setConflict(true);
        return;
      }
      if (error?.fieldErrors?.title) {
        setError('title', { message: error.fieldErrors.title[0] });
      }
      const other = error?.fieldErrors?.weeks ?? error?.fieldErrors?._form;
      setFormError(other?.join(' ') ?? error?.message ?? 'Could not save. Try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    }
  }

  const titleError = errors.title?.message;

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="flex flex-col gap-6">
        <div>
          <Link href="/app/programs" className="text-sm font-medium text-accent underline">
            Back to programs
          </Link>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Edit program</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card md:flex-row md:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={titleId} className="text-sm font-medium">
              Program title
            </label>
            <Input
              id={titleId}
              maxLength={120}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${titleId}-error` : undefined}
              {...register('title')}
            />
            {titleError && (
              <p id={`${titleId}-error`} className="text-sm text-danger">
                {titleError}
              </p>
            )}
          </div>
          <div role="group" aria-label="Days per week" className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Fewer days"
              disabled={daysPerWeek <= 1}
              onClick={() => setDays(daysPerWeek - 1)}
            >
              <Minus aria-hidden className="size-5" />
            </Button>
            <output className="min-w-28 text-center text-base font-medium">
              {daysPerWeek} {daysPerWeek === 1 ? 'day' : 'days'} per week
            </output>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="More days"
              disabled={daysPerWeek >= MAX_DAYS}
              onClick={() => setDays(daysPerWeek + 1)}
            >
              <Plus aria-hidden className="size-5" />
            </Button>
          </div>
        </div>

        <Tabs value={activeWeek} onValueChange={setActiveWeek}>
          <div className="flex items-center gap-2">
            <TabsList className="min-w-0 flex-1">
              {weeks.fields.map((f, w) => (
                <TabsTrigger key={f.id} value={String(w)}>
                  Week {w + 1}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={weeks.fields.length >= MAX_WEEK_COUNT}
              onClick={addWeek}
            >
              Add week
            </Button>
          </div>
          {weeks.fields.map((f, w) => (
            <TabsContent key={f.id} value={String(w)} className="flex flex-col gap-4">
              {Array.from({ length: daysPerWeek }, (_, d) => (
                <DayCard key={d} week={w} day={d} units={units} />
              ))}
            </TabsContent>
          ))}
        </Tabs>

        {conflict && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-card border border-danger bg-surface p-4"
          >
            <p className="min-w-0 flex-1 text-sm">
              This program changed in another tab. Reload to see the latest version.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                skipGuard.current = true;
                window.location.reload();
              }}
            >
              Reload
            </Button>
          </div>
        )}
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="sticky bottom-16 flex flex-wrap items-center gap-3 rounded-card bg-surface p-4 shadow-card md:bottom-0">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
          <p className="text-sm text-secondary">Save to keep changes</p>
          <p role="status" className="text-sm font-medium">
            {isDirty ? 'Unsaved changes' : savedAs !== null ? `Saved as version ${savedAs}` : ''}
          </p>
        </div>
      </form>
    </FormProvider>
  );
}
