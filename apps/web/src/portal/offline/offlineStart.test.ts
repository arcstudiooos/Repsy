import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDetail } from '@repsy/core';
import { getAll } from './db';
import { checkIntegrity, INTEGRITY_EVERY_MS, missingOnServer } from './integrity';
import { enqueue, flush, syncState, type Mutation, type RejectedMutation } from './outbox';
import { ackAll, detail, freshDeviceStore, item, SESSION, stubServer } from './test-helpers';
import {
  applyLocal,
  cacheWorkout,
  clearDraft,
  getCachedWorkout,
  localView,
  markStartedHere,
  saveDraft,
} from './workoutCache';

const T0 = new Date('2026-11-04T12:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();
const WV = '33333333-3333-4333-8333-333333333333';
const planned = () =>
  ({
    ...detail({ state: 'scheduled', startedAt: null }),
    workout: { workoutVersionId: WV, exercises: [] },
  }) as unknown as SessionDetail;
const startBody = { expectedWorkoutVersionId: WV, startedAt: at(0) };
const logged = (i: ReturnType<typeof item>) => {
  const { clientMutationId: _id, ...rest } = i;
  void _id;
  return rest;
};

beforeEach(async () => {
  await freshDeviceStore();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(async () => {
  await flush();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offline start (PRD D4)', () => {
  it('sends the start before the sets logged after it, then caches the server copy', async () => {
    let online = false;
    const server = stubServer((path, body) =>
      !online
        ? 'offline'
        : path.endsWith('/start')
          ? { status: 200, body: { data: detail({ state: 'in_progress', startedAt: at(0) }) } }
          : ackAll(body),
    );
    const started = await markStartedHere(planned(), at(0));
    expect(started.session.state).toBe('in_progress');
    await enqueue({ id: 's', sessionId: SESSION, kind: 'start', body: startBody });
    await enqueue({
      id: 'l',
      sessionId: SESSION,
      kind: 'logs',
      body: { items: [item(0, 8, at(5))] },
    });
    expect((await syncState(SESSION)).status).toBe('saved_on_device');
    online = true;
    vi.setSystemTime(Date.now() + 61_000);
    await flush();
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['start', 'logs']);
    expect(server.calls[0]!.body).toEqual(startBody);
    expect((await syncState(SESSION)).status).toBe('synced');
  });

  it('a refused start keeps every queued set as refused and shows the workout not started', async () => {
    const message = 'Your coach changed this workout. Open it again online to start it.';
    let online = false;
    stubServer((path) =>
      !online
        ? 'offline'
        : path.endsWith('/start')
          ? { status: 409, body: { error: { code: 'CONFLICT', message } } }
          : { status: 500, body: {} },
    );
    await markStartedHere(planned(), at(0));
    await enqueue({ id: 's', sessionId: SESSION, kind: 'start', body: startBody });
    await enqueue({
      id: 'l',
      sessionId: SESSION,
      kind: 'logs',
      body: { items: [item(0, 8, at(5))] },
    });
    online = true;
    vi.setSystemTime(Date.now() + 61_000);
    await flush();
    expect(await getAll<Mutation>('outbox')).toHaveLength(0);
    const refused = await getAll<RejectedMutation>('rejected');
    expect(refused.map((r) => r.kind).sort()).toEqual(['logs', 'start']);
    expect(refused.every((r) => r.message === message)).toBe(true);
    expect((await getCachedWorkout(SESSION))?.detail.session.state).toBe('scheduled');
    expect((await syncState(SESSION)).status).toBe('not_saved');
  });
});

describe('crash recovery (PRD D20)', () => {
  it('keeps typed rows on the device until they are saved', async () => {
    await cacheWorkout(detail());
    await saveDraft(SESSION, 'row-1', { reps: '1' });
    await saveDraft(SESSION, 'row-1', { reps: '12' });
    expect((await localView(SESSION))?.drafts).toEqual({ 'row-1': { reps: '12' } });
    await clearDraft(SESSION, 'row-1');
    expect((await localView(SESSION))?.drafts).toEqual({});
  });

  it('the weekly check queues again the sets the server lacks, at most once a week', async () => {
    stubServer((_path, body) => ackAll(body));
    const kept = item(0, 8, at(1));
    const lost = item(1, 6, at(2));
    await cacheWorkout(detail());
    await applyLocal(SESSION, [logged(kept), logged(lost)]);
    const server = {
      ...detail(),
      logs: [{ ...logged(kept) }],
    } as unknown as SessionDetail;
    const fetchDetail = vi.fn(async () => server);
    const first = await checkIntegrity({ now: T0.getTime(), fetchDetail });
    expect(first).toEqual({ checked: 1, resent: 1 });
    await flush();
    expect(await checkIntegrity({ now: T0.getTime() + 1000, fetchDetail })).toBeNull();
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(
      await checkIntegrity({ now: T0.getTime() + INTEGRITY_EVERY_MS + 1, fetchDetail }),
    ).not.toBeNull();
  });

  it('compares per set: missing or older on the server, never sets the server refused', () => {
    const a = logged(item(0, 8, at(1)));
    const b = logged(item(1, 6, at(5)));
    const c = logged(item(2, 5, at(5)));
    const server = [a, { ...b, clientUpdatedAt: at(1) }];
    expect(
      missingOnServer([a, b, c], server, new Set([`${c.workoutVersionExerciseId}:2`])),
    ).toEqual([b]);
  });
});
