'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SessionDetail, Units } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  draftFromTarget,
  draftFromValues,
  EMPTY_DRAFT,
  fieldsFor,
  isBlank,
  valuesFromDraft,
  type SetDraft,
  type SetValues,
} from '@/lib/set-entry';
import { reviseSets, type RevisionPayload } from '@/lib/workout-api';

type Exercise = SessionDetail['workout']['exercises'][number];
const rowKey = (wve: string, i: number) => `${wve}:${i}`;
const LABELS: Record<keyof SetDraft, (units: Units) => string> = {
  reps: () => 'reps',
  weight: (u) => `weight (${u})`,
  rpe: () => 'RPE',
  durationSeconds: () => 'seconds',
  distanceM: () => 'metres',
};
const VALUE_KEY: Record<keyof SetDraft, keyof SetValues> = {
  reps: 'reps',
  weight: 'weightKg',
  rpe: 'rpe',
  durationSeconds: 'durationSeconds',
  distanceM: 'distanceM',
};

/**
 * Editing a finished workout's log (S3-4): the client's own edit within 24 hours, or a coach's correction with a
 * required reason. Online only: it calls `PATCH /sessions/:id/logs` directly, never the offline outbox. Only the
 * fields the user changed are sent, so an untouched load never drifts through a kg/lb round trip.
 */
export function LogEditor({
  detail,
  mode,
  units,
  deadlineLabel,
}: {
  detail: SessionDetail;
  mode: 'client' | 'coach';
  /** The viewer's units. */
  units: Units;
  /** Client mode: when the edit window closes, e.g. "Fri 30 Oct, 14:05" (in the client's zone). */
  deadlineLabel?: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logged = new Map(
    detail.logs.map((l) => [rowKey(l.workoutVersionExerciseId, l.setIndex), l]),
  );
  const original = (key: string): SetDraft => {
    const l = logged.get(key);
    return l ? draftFromValues(l, units) : EMPTY_DRAFT;
  };
  const rowCount = (e: Exercise) =>
    Math.max(
      e.sets.length,
      1,
      ...detail.logs.filter((l) => l.workoutVersionExerciseId === e.id).map((l) => l.setIndex + 1),
    );
  const isCoach = mode === 'coach';
  const titleLevel = isCoach ? 'h4' : 'h3';

  function start() {
    setDrafts(
      Object.fromEntries(
        detail.logs.map((l) => [
          rowKey(l.workoutVersionExerciseId, l.setIndex),
          draftFromValues(l, units),
        ]),
      ),
    );
    setRowErrors({});
    setReason('');
    setReasonError(null);
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    if (busy) return;
    setFormError(null);
    setReasonError(null);
    const items: RevisionPayload[] = [];
    const errors: Record<string, string> = {};
    for (const e of detail.workout.exercises) {
      for (let i = 0; i < rowCount(e); i++) {
        const key = rowKey(e.id, i);
        const before = original(key);
        const draft = drafts[key] ?? before;
        const changed = fieldsFor(e.trackingType).filter((f) => draft[f] !== before[f]);
        if (changed.length === 0) continue;
        const parsed = valuesFromDraft(draft, e.trackingType, units);
        if (!parsed.ok) {
          errors[key] = parsed.message;
          continue;
        }
        if (!logged.has(key) && isBlank(parsed.values)) continue;
        const item: RevisionPayload = {
          workoutVersionExerciseId: e.id,
          setIndex: i,
          clientUpdatedAt: new Date().toISOString(),
          clientMutationId: crypto.randomUUID(),
        };
        for (const f of changed) item[VALUE_KEY[f]] = parsed.values[VALUE_KEY[f]];
        items.push(item);
      }
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (isCoach && reason.trim() === '') {
      setReasonError('Add a reason for the correction.');
      return;
    }
    if (items.length === 0) {
      setFormError('Nothing has changed yet.');
      return;
    }
    setBusy(true);
    const res = await reviseSets(detail.session.id, items, isCoach ? reason : undefined);
    setBusy(false);
    if (!res.ok) {
      const r = res.fieldErrors?.reason?.[0];
      if (r) setReasonError(r);
      else setFormError(res.message);
      return;
    }
    toast.success(isCoach ? 'Correction saved' : 'Log updated');
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mt-6 flex flex-col gap-2">
        {!isCoach && deadlineLabel && (
          <p className="text-secondary">You can edit until {deadlineLabel}.</p>
        )}
        <Button variant="secondary" className="self-start" onClick={start}>
          {isCoach ? 'Correct log' : 'Edit log'}
        </Button>
      </div>
    );
  }

  const reasonId = `${ids}-reason`;
  return (
    <section aria-labelledby={`${ids}-title`} className="mt-6 flex flex-col gap-4">
      {isCoach ? (
        <h3 id={`${ids}-title`} className="text-lg font-semibold">
          Correct log
        </h3>
      ) : (
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          Edit log
        </h2>
      )}
      {!isCoach && deadlineLabel && (
        <p className="text-secondary">You can edit until {deadlineLabel}.</p>
      )}
      <ol className="flex flex-col gap-3">
        {detail.workout.exercises.map((e) => (
          <li key={e.id}>
            <section aria-label={e.name}>
              <Card>
                <CardHeader className="mb-2">
                  <CardTitle as={titleLevel}>{e.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {Array.from({ length: rowCount(e) }, (_, i) => {
                    const key = rowKey(e.id, i);
                    const draft = drafts[key] ?? original(key);
                    const placeholder = draftFromTarget(e.sets[i], units);
                    const error = rowErrors[key];
                    return (
                      <fieldset
                        key={key}
                        className="flex flex-col gap-2 rounded-control border border-divider p-3"
                      >
                        <legend className="px-1 text-sm font-semibold">Set {i + 1}</legend>
                        <div className="grid grid-cols-3 gap-2">
                          {fieldsFor(e.trackingType).map((f) => {
                            const id = `${ids}-${key}-${f}`;
                            return (
                              <div key={f} className="flex min-w-0 flex-col gap-1">
                                <label htmlFor={id} className="text-sm text-secondary">
                                  {LABELS[f](units)}
                                </label>
                                <Input
                                  id={id}
                                  aria-label={`Set ${i + 1} ${LABELS[f](units)}`}
                                  inputMode={
                                    f === 'reps' || f === 'durationSeconds' ? 'numeric' : 'decimal'
                                  }
                                  autoComplete="off"
                                  className="min-h-12"
                                  placeholder={placeholder[f]}
                                  value={draft[f]}
                                  aria-invalid={error ? true : undefined}
                                  aria-describedby={error ? `${ids}-${key}-error` : undefined}
                                  onChange={(ev) =>
                                    setDrafts((all) => ({
                                      ...all,
                                      [key]: { ...draft, [f]: ev.target.value },
                                    }))
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                        {error && (
                          <p id={`${ids}-${key}-error`} className="text-sm text-danger">
                            {error}
                          </p>
                        )}
                      </fieldset>
                    );
                  })}
                </CardContent>
              </Card>
            </section>
          </li>
        ))}
      </ol>
      {isCoach && (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Reason for the correction
          </label>
          <textarea
            id={reasonId}
            required
            maxLength={500}
            rows={3}
            value={reason}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-hint`}
            onChange={(ev) => setReason(ev.target.value)}
            className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
          />
          {reasonError ? (
            <p id={`${reasonId}-error`} className="text-sm text-danger">
              {reasonError}
            </p>
          ) : (
            <p id={`${reasonId}-hint`} className="text-sm text-secondary">
              Shown to coaches only. The client sees &quot;Corrected by your coach&quot;.
            </p>
          )}
        </div>
      )}
      {formError && (
        <p role="alert" className="text-danger">
          {formError}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button className="min-h-12" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : isCoach ? 'Save correction' : 'Save changes'}
        </Button>
        <Button variant="secondary" className="min-h-12" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
