'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { SessionDetail, TrackingType, Units } from '@kinetic/core';
import { LoggedByCoachBadge, SessionStateBadge } from '@/components/sessions/SessionStateBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { formatSessionDate } from '@/lib/session-format';
import {
  draftFromTarget,
  draftFromValues,
  EMPTY_DRAFT,
  isBlank,
  valuesFromDraft,
  type SetDraft,
} from '@/lib/set-entry';
import { saveSets, startWorkout } from '@/lib/workout-api';
import { FinishDialog } from './FinishDialog';
import { SetRow, type RowStatus } from './SetRow';

type Exercise = SessionDetail['workout']['exercises'][number];
const MAX_SETS = 20;
const rowKey = (wve: string, i: number) => `${wve}:${i}`;

function describeTarget(e: Exercise, units: Units): string {
  return e.sets
    .map((t) => {
      const d = draftFromTarget(t, units);
      if (e.trackingType === 'duration') return d.durationSeconds ? `${d.durationSeconds}s` : '-';
      if (e.trackingType === 'distance') return d.distanceM ? `${d.distanceM} m` : '-';
      return d.weight ? `${d.reps || '-'} × ${d.weight} ${units}` : `${d.reps || '-'} reps`;
    })
    .join(', ');
}

function describeSet(
  trackingType: TrackingType,
  v: {
    reps: number | null;
    weightKg: number | null;
    rpe: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
  },
  units: Units,
): string {
  const d = draftFromValues(v, units);
  if (trackingType === 'duration') return d.durationSeconds ? `${d.durationSeconds}s` : '-';
  if (trackingType === 'distance') return d.distanceM ? `${d.distanceM} m` : '-';
  const load = d.weight ? ` × ${d.weight} ${units}` : '';
  const rpe = d.rpe ? ` @ RPE ${d.rpe}` : '';
  return `${d.reps || '-'} reps${load}${rpe}`;
}

/**
 * The workout screen (S2-2), shared by the client portal and the coach logging view (S2-3). Online only in
 * Sprint 2: each set saves when a field loses focus, and its status reads "Syncing" until the server acknowledges
 * it, then "Synced" (D-004 #6). It never claims "Saved on device"; that arrives with the IndexedDB outbox (S3-3).
 */
export function WorkoutLogger({
  initial,
  mode,
  units,
  todayLocalDate,
  backHref,
}: {
  initial: SessionDetail;
  mode: 'client' | 'coach';
  /** The viewer's units: the client's preference in the portal, the coach's in the coach view. */
  units: Units;
  todayLocalDate: string;
  /** Where to go after finishing (the workout list). */
  backHref: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const logged = new Map(
    detail.logs.map((l) => [rowKey(l.workoutVersionExerciseId, l.setIndex), l]),
  );
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>(() =>
    Object.fromEntries(
      initial.logs.map((l) => [
        rowKey(l.workoutVersionExerciseId, l.setIndex),
        draftFromValues(l, units),
      ]),
    ),
  );
  const [status, setStatus] = useState<Record<string, RowStatus>>(() =>
    Object.fromEntries(
      initial.logs.map((l) => [rowKey(l.workoutVersionExerciseId, l.setIndex), { kind: 'synced' }]),
    ),
  );
  const [extraRows, setExtraRows] = useState<Record<string, number>>({});
  // The draft last acknowledged per row, so an unchanged blur sends nothing.
  const synced = useRef<Record<string, string>>(
    Object.fromEntries(
      initial.logs.map((l) => [
        rowKey(l.workoutVersionExerciseId, l.setIndex),
        JSON.stringify(draftFromValues(l, units)),
      ]),
    ),
  );
  // The latest drafts, read by saves that resolve after more typing.
  const draftsRef = useRef(drafts);
  // Rows with a request in flight: at most one per row, so acks can't arrive out of order.
  const inflight = useRef<Set<string>>(new Set());

  const { session, workout } = detail;

  const rowCount = (e: Exercise) => {
    const loggedMax = Math.max(
      -1,
      ...detail.logs.filter((l) => l.workoutVersionExerciseId === e.id).map((l) => l.setIndex),
    );
    return Math.min(MAX_SETS, Math.max(e.sets.length, loggedMax + 1, 1) + (extraRows[e.id] ?? 0));
  };

  /**
   * Saves a row's latest draft. "Synced" is shown only when the draft on screen equals what the server acknowledged
   * (D-004 #6): a commit while a request is in flight waits for it, and every ack re-checks the latest draft, sending
   * again when the user changed it meanwhile.
   */
  async function save(e: Exercise, setIndex: number): Promise<void> {
    const key = rowKey(e.id, setIndex);
    if (inflight.current.has(key)) return;
    const draft = draftsRef.current[key] ?? EMPTY_DRAFT;
    const snapshot = JSON.stringify(draft);
    const parsed = valuesFromDraft(draft, e.trackingType, units);
    if (!parsed.ok) {
      const { field, message } = parsed;
      setStatus((s) => ({ ...s, [key]: { kind: 'invalid', field, message } }));
      return;
    }
    if (synced.current[key] === snapshot) {
      setStatus((s) => ({ ...s, [key]: { kind: 'synced' } }));
      return;
    }
    if (synced.current[key] === undefined && isBlank(parsed.values)) {
      setStatus((s) => ({ ...s, [key]: { kind: 'idle' } }));
      return;
    }
    inflight.current.add(key);
    setStatus((s) => ({ ...s, [key]: { kind: 'syncing' } }));
    const res = await saveSets(session.id, [
      {
        workoutVersionExerciseId: e.id,
        setIndex,
        ...parsed.values,
        clientUpdatedAt: new Date().toISOString(),
        clientMutationId: crypto.randomUUID(),
      },
    ]);
    inflight.current.delete(key);
    if (!res.ok) {
      setStatus((s) => ({ ...s, [key]: { kind: 'error', message: res.message } }));
      return;
    }
    const ack = res.data[0];
    if (ack?.status === 'stale') {
      // Another device wrote a newer value: the server keeps it. Show it unless the user typed on meanwhile.
      const server = draftFromValues(ack.value, units);
      synced.current[key] = JSON.stringify(server);
      if (JSON.stringify(draftsRef.current[key] ?? EMPTY_DRAFT) === snapshot) {
        draftsRef.current = { ...draftsRef.current, [key]: server };
        setDrafts((d) => ({ ...d, [key]: server }));
      }
    } else {
      synced.current[key] = snapshot;
    }
    // Re-check the latest draft: Synced if unchanged, otherwise save the newer value.
    await save(e, setIndex);
  }

  const onDraftChange = (key: string, d: SetDraft) => {
    draftsRef.current = { ...draftsRef.current, [key]: d };
    setDrafts((all) => ({ ...all, [key]: d }));
    // An edit not yet sent is never shown as synced.
    if (!inflight.current.has(key) && synced.current[key] !== JSON.stringify(d)) {
      const kind = synced.current[key] === undefined ? 'idle' : 'unsaved';
      setStatus((s) => ({ ...s, [key]: { kind } }));
    }
  };

  async function onStart() {
    setStarting(true);
    setStartError(null);
    const res = await startWorkout(session.id);
    setStarting(false);
    if (res.ok) {
      // Local state only: a refresh would remount the logger mid-entry.
      setDetail(res.data);
    } else {
      setStartError(res.message);
    }
  }

  const unsynced = Object.values(status).some((s) => s.kind !== 'synced' && s.kind !== 'idle');

  const header = (
    <div className="mb-6 flex flex-col gap-2">
      <p className="text-sm text-secondary">
        {formatSessionDate(session.scheduledLocalDate, todayLocalDate)}
      </p>
      <h1 className="text-2xl font-semibold break-words md:text-3xl">{workout.title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <SessionStateBadge state={session.state} overdue={session.overdue} />
        {session.loggedByCoach && <LoggedByCoachBadge />}
      </div>
      {mode === 'coach' && (
        <p className="rounded-control border border-input-border bg-surface px-3 py-2">
          You&apos;re logging for {detail.client.name}.
        </p>
      )}
      {workout.notes && <p className="text-secondary">{workout.notes}</p>}
    </div>
  );

  if (session.state === 'scheduled') {
    return (
      <>
        {header}
        <ol className="mb-6 flex flex-col gap-3">
          {workout.exercises.map((e) => (
            <li key={e.id}>
              <Card>
                <CardHeader className="mb-1">
                  <CardTitle>{e.name}</CardTitle>
                  <CardDescription>{describeTarget(e, units)}</CardDescription>
                </CardHeader>
                {e.note && <CardContent className="text-sm">{e.note}</CardContent>}
              </Card>
            </li>
          ))}
        </ol>
        {startError && (
          <p role="alert" className="mb-3 text-danger">
            {startError}
          </p>
        )}
        <Button className="min-h-14 w-full text-lg" onClick={onStart} disabled={starting}>
          {starting ? 'Starting…' : 'Start workout'}
        </Button>
        <div className="mt-3 flex justify-center">
          <FinishDialog
            kind="skip"
            sessionId={session.id}
            onDone={(done) => {
              setDetail(done);
              toast.success('Workout skipped');
              router.push(`${backHref}?scope=past`);
              router.refresh();
            }}
          />
        </div>
      </>
    );
  }

  if (session.state !== 'in_progress') {
    return (
      <>
        {header}
        {session.comment && (
          <Card className="mb-4">
            <CardHeader className="mb-1">
              <CardDescription>Comment</CardDescription>
            </CardHeader>
            <CardContent className="break-words whitespace-pre-line">{session.comment}</CardContent>
          </Card>
        )}
        <ol className="flex flex-col gap-3">
          {workout.exercises.map((e) => {
            const sets = detail.logs.filter(
              (l) => l.workoutVersionExerciseId === e.id && !isBlank(l),
            );
            return (
              <li key={e.id}>
                <Card>
                  <CardHeader className="mb-2">
                    <CardTitle>{e.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sets.length === 0 ? (
                      <p className="text-secondary">No sets logged.</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {sets.map((l) => (
                          <li key={l.setIndex}>
                            Set {l.setIndex + 1}: {describeSet(e.trackingType, l, units)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </>
    );
  }

  return (
    <>
      {header}
      <ol className="flex flex-col gap-4">
        {workout.exercises.map((e) => {
          const prev = detail.previous[e.exerciseId];
          return (
            <li key={e.id}>
              <section aria-label={e.name}>
                <Card>
                  <CardHeader className="mb-3">
                    <CardTitle>{e.name}</CardTitle>
                    <CardDescription>Target: {describeTarget(e, units)}</CardDescription>
                    {prev && (
                      <CardDescription>
                        Last time ({formatSessionDate(prev.localDate, todayLocalDate)}):{' '}
                        {prev.sets.map((s) => describeSet(e.trackingType, s, units)).join(', ')}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {e.note && <p className="text-sm">{e.note}</p>}
                    {e.instructions && (
                      <details className="text-sm">
                        <summary className="min-h-11 cursor-pointer py-2 text-accent">
                          How to do it
                        </summary>
                        <p className="text-secondary">{e.instructions}</p>
                      </details>
                    )}
                    {Array.from({ length: rowCount(e) }, (_, i) => {
                      const key = rowKey(e.id, i);
                      return (
                        <SetRow
                          key={key}
                          index={i}
                          trackingType={e.trackingType}
                          units={units}
                          draft={drafts[key] ?? EMPTY_DRAFT}
                          placeholder={draftFromTarget(e.sets[i], units)}
                          status={
                            status[key] ?? (logged.has(key) ? { kind: 'synced' } : { kind: 'idle' })
                          }
                          onChange={(d) => onDraftChange(key, d)}
                          onCommit={() => void save(e, i)}
                        />
                      );
                    })}
                    {rowCount(e) < MAX_SETS && (
                      <Button
                        variant="secondary"
                        className="self-start"
                        onClick={() => setExtraRows((x) => ({ ...x, [e.id]: (x[e.id] ?? 0) + 1 }))}
                      >
                        Add set
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </section>
            </li>
          );
        })}
      </ol>
      {unsynced && (
        <p role="status" className="mt-4 text-warning">
          Some sets aren&apos;t synced yet. Fix or retry them before you finish.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <FinishDialog
          kind="complete"
          sessionId={session.id}
          disabled={unsynced}
          onDone={(done) => {
            setDetail(done);
            toast.success('Workout completed');
            router.push(`${backHref}?scope=past`);
            router.refresh();
          }}
        />
        <FinishDialog
          kind="skip"
          sessionId={session.id}
          disabled={unsynced}
          onDone={(done) => {
            setDetail(done);
            toast.success('Workout skipped');
            router.push(`${backHref}?scope=past`);
            router.refresh();
          }}
        />
      </div>
    </>
  );
}
