'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { LoggedSet, SessionDetail, TrackingType, Units } from '@kinetic/core';
import {
  LoggedByCoachBadge,
  RevisionMark,
  SessionStateBadge,
} from '@/components/sessions/SessionStateBadge';
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
import { saveSets, startWorkout, type SetLogPayload } from '@/lib/workout-api';
import { hasDeviceStore } from '@/portal/offline/db';
import { enqueue, flush, retryBlocked, syncState } from '@/portal/offline/outbox';
import { cacheWorkoutPage, uncacheWorkoutPage } from '@/portal/offline/registerSw';
import { useOnline, useSyncStatus } from '@/portal/offline/useSyncStatus';
import {
  applyLocal,
  cacheWorkout,
  evict,
  localView,
  markFinished,
  newest,
  type LocalView,
} from '@/portal/offline/workoutCache';
import { FinishDialog, type FinishBody } from './FinishDialog';
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

const SYNC_LABEL = {
  saved_on_device: 'Saved on device',
  syncing: 'Syncing',
  synced: 'Synced',
} as const;
const OFFLINE_START = "You're offline. Open this workout while online to start it.";
const CLOCK_BLOCKED = 'Your device clock is ahead. Fix the date and time, then tap Retry.';

const toLogged = (p: SetLogPayload): LoggedSet => ({
  workoutVersionExerciseId: p.workoutVersionExerciseId,
  setIndex: p.setIndex,
  reps: p.reps,
  weightKg: p.weightKg,
  rpe: p.rpe,
  durationSeconds: p.durationSeconds,
  distanceM: p.distanceM,
  clientUpdatedAt: p.clientUpdatedAt,
});

/**
 * The workout screen (S2-2), shared by the client portal and the coach logging view (S2-3). Each set saves when a
 * field loses focus. In the portal (S3-3) every write is stored on the device first ("Saved on device") and sent by
 * the IndexedDB outbox ("Syncing"), so logging and finishing keep working offline; "Synced" only once the server
 * acknowledged every queued write (D-004 #6). The coach view calls the API directly ("Syncing" until acknowledged).
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
  const deviceFirst = mode === 'client';
  const online = useOnline();
  const sync = useSyncStatus(initial.session.id, deviceFirst);
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
  // Coach mode sits under the client page's h1 and a workout h2.
  const titleLevel = mode === 'coach' ? 'h3' : 'h2';

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
    const payload: SetLogPayload = {
      workoutVersionExerciseId: e.id,
      setIndex,
      ...parsed.values,
      clientUpdatedAt: new Date().toISOString(),
      clientMutationId: crypto.randomUUID(),
    };
    if (deviceFirst) {
      // Device first: the outbox sends it (now, or once back online) and the row reads from its state.
      synced.current[key] = snapshot;
      await applyLocal(session.id, [toLogged(payload)]);
      await enqueue({
        id: payload.clientMutationId,
        sessionId: session.id,
        kind: 'logs',
        body: { items: [payload] },
      });
      setStatus((s) => ({ ...s, [key]: { kind: 'saved' } }));
      return;
    }
    inflight.current.add(key);
    setStatus((s) => ({ ...s, [key]: { kind: 'syncing' } }));
    const res = await saveSets(session.id, [payload]);
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

  /**
   * Portal: brings in what this device holds (values typed offline, a finish still queued, newer server values from
   * stale acks). Rows with an edit not yet handed to the outbox keep what is on screen.
   */
  function applyDeviceView(view: LocalView): void {
    const logs = newest(initial.logs, view.logs);
    const finishedHere = view.finished && initial.session.state === 'in_progress';
    setDetail((d) => ({
      ...d,
      logs: newest(d.logs, logs),
      session: finishedHere ? { ...d.session, state: view.finished! } : d.session,
    }));
    const next: Record<string, SetDraft> = {};
    for (const l of logs) {
      const key = rowKey(l.workoutVersionExerciseId, l.setIndex);
      const current = draftsRef.current[key];
      const untouched =
        current === undefined
          ? synced.current[key] === undefined
          : synced.current[key] === JSON.stringify(current);
      if (!untouched) continue;
      const d = draftFromValues(l, units);
      synced.current[key] = JSON.stringify(d);
      next[key] = d;
    }
    if (Object.keys(next).length === 0) return;
    draftsRef.current = { ...draftsRef.current, ...next };
    setDrafts((all) => ({ ...all, ...next }));
    setStatus((s) => ({
      ...s,
      ...Object.fromEntries(Object.keys(next).map((k) => [k, { kind: 'synced' as const }])),
    }));
  }

  const pullDevice = () => {
    let live = true;
    void localView(initial.session.id).then((view) => {
      if (live && view) applyDeviceView(view);
    });
    return () => {
      live = false;
    };
  };

  useEffect(() => {
    if (!deviceFirst || !hasDeviceStore()) return;
    const stop = pullDevice();
    // Once the server holds the finished session and nothing waits to sync, the device copy can go.
    if (initial.session.state === 'completed' || initial.session.state === 'skipped') {
      void evict(initial.session.id).then((gone) => gone && uncacheWorkoutPage(initial.session.id));
    }
    return stop;
    // Mount only: later server payloads remount this component (the page's `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncStatus = sync?.status;
  useEffect(() => {
    if (syncStatus !== 'synced' || !deviceFirst) return;
    return pullDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus]);

  async function onStart() {
    if (deviceFirst && !online) return;
    setStarting(true);
    setStartError(null);
    const res = await startWorkout(session.id);
    setStarting(false);
    if (res.ok) {
      if (deviceFirst) {
        // Keep the workout on the device so it can be logged, closed and reopened offline.
        await cacheWorkout(res.data);
        cacheWorkoutPage(session.id);
      }
      setDetail(res.data);
      // Already started elsewhere with sets logged: reload so the rows show what the server holds. Otherwise local
      // state only, since a refresh would remount the logger mid-entry.
      if (res.data.logs.length > 0) router.refresh();
    } else {
      setStartError(res.message);
    }
  }

  // Portal rows stored on the device are safe to finish with: the outbox sends them before the completion.
  const unsynced = Object.values(status).some((s) =>
    deviceFirst
      ? s.kind === 'invalid' || s.kind === 'unsaved' || s.kind === 'error'
      : s.kind !== 'synced' && s.kind !== 'idle',
  );

  /** A row's status as shown: in the portal, stored rows follow the outbox (Saved on device, Syncing, Synced). */
  const shownStatus = (key: string): RowStatus => {
    const local = status[key] ?? (logged.has(key) ? { kind: 'synced' } : { kind: 'idle' });
    if (!deviceFirst || (local.kind !== 'synced' && local.kind !== 'saved')) return local;
    if (sync?.pendingRows.includes(key)) {
      return { kind: sync.status === 'syncing' ? 'syncing' : 'saved' };
    }
    return sync ? { kind: 'synced' } : local;
  };

  /** Portal: complete/skip go through the outbox, after this session's set logs. */
  const queueFinish =
    (kind: 'complete' | 'skip') =>
    async (body: FinishBody): Promise<{ ok: true; data: SessionDetail }> => {
      const state = kind === 'complete' ? 'completed' : 'skipped';
      await markFinished(session.id, state);
      await enqueue({ id: body.idempotencyKey, sessionId: session.id, kind, body });
      await flush();
      return {
        ok: true,
        data: { ...detail, session: { ...detail.session, state, comment: body.comment ?? null } },
      };
    };

  async function onFinished(done: SessionDetail, kind: 'complete' | 'skip') {
    const word = kind === 'complete' ? 'completed' : 'skipped';
    setDetail(done);
    if (deviceFirst) {
      const st = await syncState(session.id);
      if (st.status !== 'synced' || st.rejected.length > 0) {
        // Offline (or refused): stay on the finished workout, which shows what is still on the device.
        toast.success(`Workout ${word}. Saved on device.`);
        return;
      }
      if (await evict(session.id)) uncacheWorkoutPage(session.id);
    }
    toast.success(`Workout ${word}`);
    router.push(`${backHref}?scope=past`);
    router.refresh();
  }

  const syncPanel =
    deviceFirst && sync ? (
      <div className="mb-4 flex flex-col gap-2">
        <p role="status" className={sync.status === 'synced' ? 'text-accent' : 'text-secondary'}>
          {SYNC_LABEL[sync.status]}
        </p>
        {sync.blockedReason && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-danger">
              {CLOCK_BLOCKED}
            </p>
            <Button variant="secondary" onClick={() => void retryBlocked(session.id)}>
              Retry
            </Button>
          </div>
        )}
        {sync.rejected.map((r, i) => (
          <p key={i} role="alert" className="text-danger">
            Some changes couldn&apos;t be saved: {r.message}
          </p>
        ))}
      </div>
    ) : null;

  const header = (
    <div className="mb-6 flex flex-col gap-2">
      <p className="text-sm text-secondary">
        {formatSessionDate(session.scheduledLocalDate, todayLocalDate)}
      </p>
      {mode === 'coach' ? (
        // The client page layout already holds the page's h1 (the client's name).
        <h2 className="text-2xl font-semibold break-words">{workout.title}</h2>
      ) : (
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{workout.title}</h1>
      )}
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
                  <CardTitle as={titleLevel}>{e.name}</CardTitle>
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
        {deviceFirst && !online && (
          <p role="status" className="mb-3 text-secondary">
            {OFFLINE_START}
          </p>
        )}
        <Button
          className="min-h-14 w-full text-lg"
          onClick={onStart}
          disabled={starting || (deviceFirst && !online)}
        >
          {starting ? 'Starting…' : 'Start workout'}
        </Button>
        <div className="mt-3 flex justify-center">
          <FinishDialog
            kind="skip"
            sessionId={session.id}
            disabled={deviceFirst && !online}
            onDone={(done) => void onFinished(done, 'skip')}
          />
        </div>
      </>
    );
  }

  if (session.state !== 'in_progress') {
    // S3-4 markers: a coach correction wins over the client's own edit (Ruling 5: never the coach's reason here).
    const marks = new Map<string, 'client' | 'coach'>();
    for (const r of detail.revisions) {
      const key = rowKey(r.workoutVersionExerciseId, r.setIndex);
      if (r.role === 'coach' || !marks.has(key)) marks.set(key, r.role);
    }
    const markLabel = (role: 'client' | 'coach') =>
      role === 'coach'
        ? mode === 'client'
          ? 'Corrected by your coach'
          : 'Corrected'
        : mode === 'client'
          ? 'Edited'
          : 'Edited by client';
    return (
      <>
        {header}
        {syncPanel}
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
                    <CardTitle as={titleLevel}>{e.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sets.length === 0 ? (
                      <p className="text-secondary">No sets logged.</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {sets.map((l) => {
                          const mark = marks.get(rowKey(e.id, l.setIndex));
                          return (
                            <li key={l.setIndex} className="flex flex-wrap items-center gap-2">
                              <span>
                                Set {l.setIndex + 1}: {describeSet(e.trackingType, l, units)}
                              </span>
                              {mark && <RevisionMark label={markLabel(mark)} />}
                            </li>
                          );
                        })}
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
      {syncPanel}
      <ol className="flex flex-col gap-4">
        {workout.exercises.map((e) => {
          const prev = detail.previous[e.exerciseId];
          return (
            <li key={e.id}>
              <section aria-label={e.name}>
                <Card>
                  <CardHeader className="mb-3">
                    <CardTitle as={titleLevel}>{e.name}</CardTitle>
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
                          status={shownStatus(key)}
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
          submit={deviceFirst ? queueFinish('complete') : undefined}
          onDone={(done) => void onFinished(done, 'complete')}
        />
        <FinishDialog
          kind="skip"
          sessionId={session.id}
          disabled={unsynced}
          submit={deviceFirst ? queueFinish('skip') : undefined}
          onDone={(done) => void onFinished(done, 'skip')}
        />
      </div>
    </>
  );
}
