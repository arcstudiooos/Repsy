'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormProvider, useFieldArray, useForm, useWatch, type FieldErrors } from 'react-hook-form';
import type { ProgramDetail, ProgramDraftView } from '@kinetic/core';
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
import type { Slot } from './DaySection';
import {
  buildEditorSchema,
  fromDraftPayload,
  mapServerWeekErrors,
  MAX_DAYS,
  newDay,
  toDraftPayload,
  toEditorValues,
  toWeekInputs,
  type EditorDay,
  type EditorValues,
} from './editorSchema';
import { PerformanceRail } from './PerformanceRail';
import { ReplaceExerciseDialog } from './ReplaceExerciseDialog';
import { SaveBar } from './SaveBar';
import { clearLocalDraft, readLocalDraft, useDraftAutosave } from './useDraftAutosave';
import { WeekSection } from './WeekSection';

const INVALID = 'Some fields need attention. Fix them and save again.';

/** The first week index with an error, so its tab can be shown. */
function firstErrorWeek(errors: FieldErrors<EditorValues>): number | null {
  const weeks = errors.weeks;
  if (!Array.isArray(weeks)) return null;
  const i = weeks.findIndex(Boolean);
  return i === -1 ? null : i;
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
  const [confirmFewer, setConfirmFewer] = useState(false);
  /** Bumped when the active week's tab should take focus. */
  const [focusTab, setFocusTab] = useState(0);
  const tabList = useRef<HTMLDivElement>(null);
  const skipGuard = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (focusTab === 0) return;
    tabList.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
  }, [focusTab, activeWeek]);

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

  /** "Fewer days" drops the last day of every week; when any of them has content, it asks first. */
  function fewerDays() {
    const last = daysPerWeek - 1;
    const hasContent = getValues('weeks').some((w) => {
      const d = w.days[last];
      return d !== undefined && (d.exercises.length > 0 || d.notes.trim() !== '');
    });
    if (hasContent) setConfirmFewer(true);
    else setDays(daysPerWeek - 1);
  }

  /** Shows week `w` and moves focus to its tab (the control that had focus may have unmounted). */
  function showWeek(w: number) {
    setActiveWeek(String(w));
    setFocusTab((n) => n + 1);
  }

  function duplicateWeek(w: number) {
    weeks.insert(w + 1, structuredClone(getValues(`weeks.${w}`)));
    showWeek(w + 1);
  }

  function removeWeek(w: number) {
    const count = getValues('weeks').length;
    weeks.remove(w);
    showWeek(Math.min(w, count - 2));
  }

  function copyToOtherWeek(target: Slot, day: EditorDay) {
    const days = [...getValues(`weeks.${target.week}.days`)];
    days[target.day] = day;
    weeks.update(target.week, { days });
  }

  function onInvalid(invalid: FieldErrors<EditorValues>) {
    setFormError(INVALID);
    const w = firstErrorWeek(invalid);
    if (w !== null) setActiveWeek(String(w));
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
      // Server paths ("0.days.1.exercises.0.sets.2: ...") land on their fields; the rest shows above the form.
      const mapped = mapServerWeekErrors(res.fieldErrors?.weeks ?? []);
      for (const f of mapped.fields) {
        setError(f.path as never, { type: 'server', message: f.message });
      }
      const first = mapped.fields[0];
      if (first) setActiveWeek(first.path.split('.')[1]!);
      const other = [...mapped.other, ...(res.fieldErrors?._form ?? [])];
      setFormError(other.length ? other.join(' ') : mapped.fields.length ? INVALID : res.message);
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

            {formError && (
              <p
                role="alert"
                className="rounded-card border border-danger bg-surface p-4 text-sm text-danger"
              >
                {formError}
              </p>
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
                    onClick={fewerDays}
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

            <div className="flex flex-wrap items-center gap-3">
              <ReplaceExerciseDialog onReplace={(next) => weeks.replace(next)} />
              {weeks.fields.length > 8 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="jump-to-week" className="text-sm font-medium">
                    Go to week
                  </label>
                  <select
                    id="jump-to-week"
                    value={activeWeek}
                    onChange={(e) => setActiveWeek(e.target.value)}
                    className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
                  >
                    {weeks.fields.map((f, w) => (
                      <option key={f.id} value={String(w)}>
                        Week {w + 1}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <Tabs value={activeWeek} onValueChange={setActiveWeek}>
              <TabsList ref={tabList} aria-label="Weeks" className="min-w-0">
                {weeks.fields.map((f, w) => (
                  <TabsTrigger key={f.id} value={String(w)}>
                    Week {w + 1}
                  </TabsTrigger>
                ))}
              </TabsList>
              {weeks.fields.map((f, w) => (
                <TabsContent key={f.id} value={String(w)}>
                  <WeekSection
                    week={w}
                    weekCount={weeks.fields.length}
                    units={units}
                    onDuplicate={() => duplicateWeek(w)}
                    onRemove={() => removeWeek(w)}
                    onCopyToOtherWeek={copyToOtherWeek}
                  />
                </TabsContent>
              ))}
            </Tabs>

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

      <Dialog open={confirmFewer} onOpenChange={setConfirmFewer}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove day {daysPerWeek} from every week?</DialogTitle>
            <DialogDescription>Its exercises will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmFewer(false)}>
              Keep day
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setConfirmFewer(false);
                setDays(daysPerWeek - 1);
              }}
            >
              Remove day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
