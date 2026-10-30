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
import type { ExerciseView, ProgramDetail, ProgramDraftView } from '@kinetic/core';
import type { TrackingType } from '@kinetic/core/exercise-options';
import type { Units } from '@kinetic/core/units';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { commitProgram, discardProgramDraft } from '@/lib/program-api';
import { ConflictNotice } from './ConflictNotice';
import { ExercisePicker } from './ExercisePicker';
import {
  buildEditorSchema,
  defaultSet,
  fromDraftPayload,
  MAX_DAYS,
  MAX_WEEK_COUNT,
  newDay,
  toDraftPayload,
  toEditorValues,
  toWeekInputs,
  type EditorValues,
} from './editorSchema';
import { PerformanceRail } from './PerformanceRail';
import { SaveBar } from './SaveBar';
import { clearLocalDraft, readLocalDraft, useDraftAutosave } from './useDraftAutosave';

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

/** Comparable form content: what a commit would send (display units back to kg). */
const contentKey = (v: Pick<EditorValues, 'title' | 'weeks'>, units: Units) =>
  JSON.stringify({ title: v.title, weeks: toWeekInputs(v as EditorValues, units) });

/** D-001, verbatim: confirmed before a client's own program is saved. */
const D001 =
  'This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged.';

export interface EditorClient {
  id: string;
  name: string;
}

export function ProgramEditor({
  program,
  units,
  draft,
  client,
}: {
  program: ProgramDetail;
  units: Units;
  /** The server draft, when one exists (S3-1). */
  draft: ProgramDraftView | null;
  /** Set for a client copy: whose active assignment runs this program. */
  client: EditorClient | null;
}) {
  const schema = useMemo(() => buildEditorSchema(units), [units]);
  const committed = useMemo(() => toEditorValues(program, units), [program, units]);
  // A server draft that differs from the saved version replaces the initial values.
  const [start] = useState(() => {
    const values = draft ? fromDraftPayload(draft, program.title, units) : null;
    if (!draft || !values || contentKey(values, units) === contentKey(committed, units)) {
      return null;
    }
    return { values, baseVersionNo: draft.baseVersionNo };
  });
  const form = useForm<EditorValues>({
    resolver: zodResolver(schema),
    defaultValues: start?.values ?? committed,
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
  const [savedSnapshot, setSavedSnapshot] = useState(() => contentKey(committed, units));
  const [savedTitle, setSavedTitle] = useState(program.title);
  /** The newest version this tab knows was committed. */
  const [versionNo, setVersionNo] = useState<number | null>(program.versionNo);
  /** The version the draft is based on: the next commit's `expectedVersion`. */
  const [baseVersionNo, setBaseVersionNo] = useState<number | null>(
    start ? start.baseVersionNo : program.versionNo,
  );
  const [conflictVersion, setConflictVersion] = useState<number | null>(
    start && program.versionNo !== null && start.baseVersionNo !== program.versionNo
      ? program.versionNo
      : null,
  );
  const [restored, setRestored] = useState(start !== null);
  const watched = useWatch({ control }) as EditorValues;
  const current = watched.weeks ? watched : committed;
  const dirty = contentKey(current, units) !== savedSnapshot || baseVersionNo !== versionNo;
  const [activeWeek, setActiveWeek] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAs, setSavedAs] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmValues, setConfirmValues] = useState<EditorValues | null>(null);
  const skipGuard = useRef(false);
  const titleId = useId();

  const draftPayload = useMemo(() => toDraftPayload(current, units), [current, units]);
  const autosave = useDraftAutosave(program.id, draftPayload, {
    baseVersionNo,
    enabled: dirty && !discarding,
  });

  // A device copy newer than the server draft (kept while offline) wins over it.
  useEffect(() => {
    const local = readLocalDraft(program.id);
    if (!local) return;
    const serverAt = draft ? Date.parse(draft.updatedAt) : Number.NEGATIVE_INFINITY;
    const values =
      Date.parse(local.savedAt) > serverAt
        ? fromDraftPayload(local.values, program.title, units)
        : null;
    if (!values || contentKey(values, units) === contentKey(committed, units)) {
      clearLocalDraft(program.id);
      return;
    }
    reset(values);
    // Intentional post-hydration sync: localStorage is unknown during SSR.
    /* eslint-disable react-hooks/set-state-in-effect */
    setActiveWeek('0');
    setBaseVersionNo(local.baseVersionNo);
    setRestored(true);
    setConflictVersion(
      program.versionNo !== null && local.baseVersionNo !== program.versionNo
        ? program.versionNo
        : null,
    );
    /* eslint-enable react-hooks/set-state-in-effect */
    // Runs once on mount: later renders must not restore over the coach's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving while a draft save is pending or failed would lose the edit.
  const unsafe = dirty && (autosave.status === 'saving' || autosave.status === 'error');
  useEffect(() => {
    if (!unsafe) return;
    const guard = (e: BeforeUnloadEvent) => {
      if (skipGuard.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [unsafe]);

  const daysPerWeek = weeks.fields[0] ? (getValues('weeks.0.days')?.length ?? 1) : 1;
  const exercises = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of current.weeks ?? []) {
      for (const d of w?.days ?? []) {
        for (const e of d?.exercises ?? []) {
          if (e?.exerciseId && !seen.has(e.exerciseId)) seen.set(e.exerciseId, e.exerciseName);
        }
      }
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [current]);

  function setDays(next: number) {
    const clamped = Math.min(MAX_DAYS, Math.max(1, next));
    const values = getValues('weeks');
    weeks.replace(
      values.map((w) => {
        const days = w.days.slice(0, clamped);
        while (days.length < clamped) days.push(newDay(days.length + 1));
        return { days };
      }),
    );
  }

  function addWeek() {
    const values = getValues('weeks');
    const last = values[values.length - 1];
    weeks.append(structuredClone(last) as EditorValues['weeks'][number]);
    setActiveWeek(String(values.length));
  }

  function onInvalid() {
    setFormError('Some fields need attention. Fix them and save again.');
  }

  async function commit(values: EditorValues) {
    setFormError(null);
    setSavedAs(null);
    setSaving(true);
    try {
      // The draft on the server holds the latest edit before the commit (which deletes it on success).
      await autosave.flush();
      const res = await commitProgram(program.id, {
        expectedVersion: baseVersionNo,
        ...(values.title !== savedTitle ? { title: values.title } : {}),
        weeks: toWeekInputs(values, units),
      });
      if (res.ok) {
        const next = toEditorValues(res.data, units);
        reset(next);
        setSavedSnapshot(contentKey(next, units));
        setSavedTitle(res.data.title);
        setVersionNo(res.data.versionNo);
        setBaseVersionNo(res.data.versionNo);
        setSavedAs(res.data.versionNo);
        setConflictVersion(null);
        setRestored(false);
        clearLocalDraft(program.id);
        return;
      }
      const newer = res.details?.currentVersionNo;
      if (res.status === 409 && typeof newer === 'number') {
        // Nothing is overwritten: the edit stays in the form and its draft is saved again (the other tab's
        // commit deleted the shared draft).
        setConflictVersion(newer);
        await autosave.flush({ force: true });
        return;
      }
      if (res.fieldErrors?.title) setError('title', { message: res.fieldErrors.title[0] });
      const other = res.fieldErrors?.weeks ?? res.fieldErrors?._form;
      setFormError(other?.join(' ') ?? res.message);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(values: EditorValues) {
    if (client) {
      setConfirmValues(values);
      return;
    }
    await commit(values);
  }

  async function reloadLatest() {
    setDiscarding(true);
    await autosave.flush();
    const res = await discardProgramDraft(program.id);
    if (!res.ok) {
      setDiscarding(false);
      setFormError(
        res.status === 0 ? res.message : "Couldn't discard the draft. Try again in a moment.",
      );
      return;
    }
    clearLocalDraft(program.id);
    skipGuard.current = true;
    window.location.reload();
  }

  function keepDraft() {
    // Rebased on the newer version; saving it is still an explicit "Save changes".
    setBaseVersionNo(conflictVersion);
    setConflictVersion(null);
  }

  const titleError = errors.title?.message;
  const locked = isSubmitting || saving || discarding;

  return (
    <FormProvider {...form}>
      <div className="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="min-w-0">
          {/* Locked while saving: an edit typed mid-save would be overwritten by the server response. */}
          <fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
            <div className="flex flex-col gap-2">
              <Link
                href={client ? `/app/clients/${client.id}/program` : '/app/programs'}
                className="text-sm font-medium text-accent underline"
              >
                {client ? `Back to ${client.name}` : 'Back to programs'}
              </Link>
              <h1 className="text-2xl font-semibold md:text-3xl">
                {client ? `Edit ${client.name}'s program` : 'Edit program'}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
                <span>{versionNo !== null ? `Version ${versionNo}` : 'Not saved yet'}</span>
                {versionNo !== null && (
                  <Link
                    href={`/app/programs/${program.id}/history`}
                    className="font-medium text-accent underline"
                  >
                    Version history
                  </Link>
                )}
              </div>
            </div>

            {restored && (
              <div className="flex flex-wrap items-center gap-3 rounded-card bg-surface p-4 shadow-card">
                <p className="min-w-0 flex-1 text-sm">Restored your unsaved draft.</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRestored(false)}>
                  Dismiss
                </Button>
              </div>
            )}

            {conflictVersion !== null && (
              <ConflictNotice
                versionNo={conflictVersion}
                onReloadLatest={reloadLatest}
                onKeepDraft={keepDraft}
              />
            )}

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
              {client ? (
                // Ruling 2: a client copy keeps one training day per scheduled weekday.
                <div className="flex flex-col gap-0.5">
                  <p className="text-base font-medium">
                    {daysPerWeek} {daysPerWeek === 1 ? 'day' : 'days'} per week
                  </p>
                  <p className="text-sm text-secondary">Matches the client&apos;s training days.</p>
                </div>
              ) : (
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
              )}
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

            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}

            <SaveBar status={autosave.status} dirty={dirty} saving={locked} savedAs={savedAs} />
          </fieldset>
        </form>

        {client && (
          <PerformanceRail
            clientId={client.id}
            clientName={client.name}
            exercises={exercises}
            units={units}
          />
        )}
      </div>

      {client && (
        <Dialog
          open={confirmValues !== null}
          onOpenChange={(open) => {
            if (!open && !saving) setConfirmValues(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save changes to {client.name}&apos;s program?</DialogTitle>
              <DialogDescription>{D001}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => setConfirmValues(null)}
              >
                Keep editing
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (confirmValues) await commit(confirmValues);
                  setConfirmValues(null);
                }}
              >
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </FormProvider>
  );
}
