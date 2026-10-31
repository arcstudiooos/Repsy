import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAll, put } from './db';
import {
  cancelFinish,
  dismissRejected,
  enqueue,
  flush,
  releaseHeld,
  retryBlocked,
  subscribe,
  syncState,
  type Mutation,
  type RejectedMutation,
} from './outbox';
import {
  ackAll,
  detail,
  freshDeviceStore,
  item,
  OWNER,
  SESSION,
  stubServer,
  WVE,
} from './test-helpers';
import {
  applyLocal,
  cacheWorkout,
  getCachedWorkout,
  localView,
  markFinished,
} from './workoutCache';

const T0 = new Date('2026-11-04T12:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

const CLOCK = "The device clock is ahead of the server's. Check its date and time.";
const DAY_AHEAD = new Date(T0.getTime() + 24 * 3600_000);
/** The server's clock stays at T0: it refuses any set stamped more than 5 minutes after it (upsertSetLogs). */
const clockCheckingServer = (path: string, body: unknown) => {
  if (!path.endsWith('/logs')) return { status: 200, body: { data: null } };
  const items = (body as { items: ReturnType<typeof item>[] }).items;
  const skewed = items.some(
    (i) => new Date(i.clientUpdatedAt).getTime() > T0.getTime() + 5 * 60_000,
  );
  return skewed
    ? {
        status: 422,
        body: {
          error: {
            code: 'VALIDATION',
            message: 'Some fields are invalid.',
            fieldErrors: { items: [CLOCK] },
          },
        },
      }
    : ackAll(body);
};

/** The device copy of a queued set (what WorkoutLogger stores with `applyLocal`). */
const logged = (i: ReturnType<typeof item>) =>
  Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'clientMutationId')) as Omit<
    ReturnType<typeof item>,
    'clientMutationId'
  >;

const finish = (key: string, kind: 'complete' | 'skip' = 'complete') =>
  enqueue({ id: key, sessionId: SESSION, kind, body: { idempotencyKey: key } });

const logs = (id: string, ...items: ReturnType<typeof item>[]) =>
  enqueue({ id, sessionId: SESSION, kind: 'logs', body: { items } });

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

describe('outbox', () => {
  it('same mutation enqueued x3 → one stored item, one request', async () => {
    let online = false;
    const server = stubServer((_p, body) => (online ? ackAll(body) : 'offline'));
    const one = item(0, 8, at(1));
    for (let i = 0; i < 3; i++) {
      await logs('m-1', one);
      await flush();
    }
    expect(await getAll<Mutation>('outbox')).toHaveLength(1);
    online = true;
    later(61_000);
    expect(await flush()).toMatchObject({ sent: 1, pending: 0 });
    expect(server.calls).toHaveLength(1);
    expect(await getAll('outbox')).toHaveLength(0);
  });

  it('logs flush before complete for a session; consecutive logs merge, newest per set', async () => {
    let online = false;
    const server = stubServer((path, body) =>
      !online
        ? 'offline'
        : path.endsWith('/logs')
          ? ackAll(body)
          : { status: 200, body: { data: null } },
    );
    await logs('a', item(0, 8, at(1)));
    await logs('b', item(0, 9, at(2)), item(1, 7, at(2)));
    await enqueue({
      id: 'done-key',
      sessionId: SESSION,
      kind: 'complete',
      body: { idempotencyKey: 'done-key' },
    });
    await flush();
    online = true;
    later(61_000);
    await flush();
    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/v1/sessions/${SESSION}/logs`,
      `/api/v1/sessions/${SESSION}/complete`,
    ]);
    const sent = (server.calls[0]!.body as { items: ReturnType<typeof item>[] }).items;
    expect(sent.map((i) => [i.setIndex, i.reps])).toEqual([
      [0, 9],
      [1, 7],
    ]);
    expect((await syncState(SESSION)).status).toBe('synced');
  });

  it('network failure keeps items and backs off', async () => {
    let online = false;
    const server = stubServer((_p, body) => (online ? ackAll(body) : 'offline'));
    await logs('m', item(0, 8, at(1)));
    await flush();
    const attempts = server.offlineAttempts();
    expect(attempts).toBeGreaterThanOrEqual(1);
    const [stored] = await getAll<Mutation>('outbox');
    expect(stored).toMatchObject({ attempts: attempts });
    expect((await syncState(SESSION)).status).toBe('saved_on_device');

    // Within the backoff nothing is sent, even once online.
    online = true;
    await flush();
    expect(server.calls).toHaveLength(0);
    later(60_000);
    await flush();
    expect(server.calls).toHaveLength(1);
    expect((await syncState(SESSION)).status).toBe('synced');
  });

  it('clock-skew 422 blocks and keeps items; Retry after fixing the clock re-stamps and succeeds', async () => {
    const server = stubServer(clockCheckingServer);
    vi.setSystemTime(DAY_AHEAD); // the device clock is a day ahead
    await logs('m', item(0, 8, new Date().toISOString()));
    expect(await flush()).toMatchObject({ blocked: 1, pending: 0 });
    expect(await syncState(SESSION)).toMatchObject({
      status: 'saved_on_device',
      blockedReason: CLOCK,
    });
    later(120_000);
    await flush();
    expect(server.calls).toHaveLength(1);

    vi.setSystemTime(T0); // the user fixes the date and time, then taps Retry
    await retryBlocked(SESSION);
    expect(server.calls).toHaveLength(2);
    const resent = (server.calls[1]!.body as { items: ReturnType<typeof item>[] }).items;
    expect(new Date(resent[0]!.clientUpdatedAt).getTime()).toBeLessThanOrEqual(T0.getTime());
    expect(await syncState(SESSION)).toMatchObject({ status: 'synced', blockedReason: undefined });
  });

  it('409 moves the item to rejected with its values; the session reads "not saved", never synced', async () => {
    stubServer(() => ({
      status: 409,
      body: { error: { code: 'SESSION_FINISHED', message: 'This workout is already finished.' } },
    }));
    const one = item(0, 8, at(1));
    await logs('m', one);
    expect(await flush()).toMatchObject({ sent: 0, pending: 0, rejected: 1 });
    expect(await getAll('outbox')).toHaveLength(0);
    expect(await syncState(SESSION)).toMatchObject({
      status: 'not_saved',
      rejected: [{ kind: 'logs', message: 'This workout is already finished.' }],
      rejectedRows: { [`${WVE}:0`]: 'This workout is already finished.' },
    });
    const [kept] = await getAll<RejectedMutation>('rejected');
    expect(kept?.body).toEqual({ items: [one] });
  });

  it('status goes saved_on_device → syncing → synced only after 2xx', async () => {
    let answer!: (r: { status: number; body: unknown }) => void;
    let lastBody: unknown;
    stubServer((_p, body) => {
      lastBody = body;
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    const seen: string[] = [];
    const stop = subscribe(SESSION, (s) => {
      if (seen.at(-1) !== s.status) seen.push(s.status);
    });
    await vi.waitFor(() => expect(seen).toEqual(['synced']));
    await logs('m', item(0, 8, at(1)));
    await vi.waitFor(() => expect(seen.at(-1)).toBe('syncing'));
    expect(seen).toEqual(['synced', 'saved_on_device', 'syncing']);
    expect((await syncState(SESSION)).pendingRows).toHaveLength(1);
    answer(ackAll(lastBody));
    await flush();
    await vi.waitFor(() => expect(seen.at(-1)).toBe('synced'));
    expect(seen).toEqual(['synced', 'saved_on_device', 'syncing', 'synced']);
    stop();
  });

  it('orders by a sequence, not the clock: a Complete tapped after fixing the clock waits for the blocked logs', async () => {
    const server = stubServer(clockCheckingServer);
    vi.setSystemTime(DAY_AHEAD);
    await logs('a', item(0, 8, new Date().toISOString()));
    await flush();
    vi.setSystemTime(T0); // clock fixed, then Complete (wall clock now earlier than the logs)
    await finish('done');
    later(120_000);
    await flush();
    // Nothing after the blocked logs goes out: the session isn't completed without its sets.
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs']);
    await retryBlocked(SESSION);
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs', 'logs', 'complete']);
  });

  it('a blocked item blocks every later item of its session', async () => {
    stubServer(() => 'offline');
    await logs('a', item(0, 8, at(1)));
    await logs('b', item(1, 8, at(2)));
    await finish('done');
    await flush();
    // A clock block on the middle logs (as a 422 leaves it); the items around it are due and unblocked.
    for (const m of await getAll<Mutation>('outbox')) {
      await put<Mutation>('outbox', {
        ...m,
        nextAttemptAt: undefined,
        blockedReason: m.id === 'b' ? CLOCK : undefined,
      });
    }
    const server = stubServer((path, body) =>
      path.endsWith('/logs') ? ackAll(body) : { status: 200, body: { data: null } },
    );
    await flush();
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs']);
    const sent = (server.calls[0]!.body as { items: ReturnType<typeof item>[] }).items;
    expect(sent.map((i) => i.setIndex)).toEqual([0]);
  });

  it('Retry keeps per-set newest-wins: a correction typed after the fix beats the skewed value', async () => {
    const server = stubServer(clockCheckingServer);
    await cacheWorkout(detail());
    vi.setSystemTime(DAY_AHEAD);
    const skewed = item(0, 8, new Date().toISOString());
    await applyLocal(SESSION, [logged(skewed)]);
    await logs('a', skewed);
    await flush();
    vi.setSystemTime(T0);
    const correction = item(0, 9, new Date().toISOString()); // typed after fixing the clock
    await applyLocal(SESSION, [logged(correction)]);
    await logs('b', correction);
    later(1000);
    await retryBlocked(SESSION);
    const sent = (server.calls.at(-1)!.body as { items: ReturnType<typeof item>[] }).items;
    expect(sent.map((i) => [i.setIndex, i.reps])).toEqual([[0, 9]]);
    expect((await localView(SESSION))?.logs.map((l) => l.reps)).toEqual([9]);
  });
});

describe('outbox rejections (PR #2 review I1)', () => {
  const BAD = 'items: 1.reps: Number must be less than or equal to 1000';
  /** Refuses (422, not the clock) any batch holding set 1; acks the rest. */
  const pickyServer = (path: string, body: unknown) => {
    if (!path.endsWith('/logs')) {
      return { status: 200, body: { data: detail({ state: 'completed' }) } };
    }
    const items = (body as { items: ReturnType<typeof item>[] }).items;
    return items.some((i) => i.setIndex === 1)
      ? {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION',
              message: 'Some fields are invalid.',
              fieldErrors: { items: [BAD] },
            },
          },
        }
      : ackAll(body);
  };

  it('a batch 422 is retried item by item: one bad set never rejects the good ones', async () => {
    let online = false;
    const server = stubServer((p, b) => (online ? pickyServer(p, b) : 'offline'));
    await logs('a', item(0, 8, at(1)));
    await logs('b', item(1, 9999, at(2)));
    await logs('c', item(2, 7, at(3)));
    await flush();
    online = true;
    later(61_000);
    expect(await flush()).toMatchObject({ sent: 2, pending: 0, rejected: 1 });
    const acked = server.calls
      .filter((c) => c.path.endsWith('/logs'))
      .map((c) => (c.body as { items: ReturnType<typeof item>[] }).items.map((i) => i.setIndex))
      .filter((ix) => !ix.includes(1))
      .flat();
    expect(acked.sort()).toEqual([0, 2]);
    const state = await syncState(SESSION);
    expect(state.status).toBe('not_saved');
    expect(state.rejectedRows).toEqual({ [`${WVE}:1`]: BAD });
    expect(state.pendingRows).toEqual([]);
  });

  it("a session's completion is held while its logs were rejected; Finish anyway sends it", async () => {
    const server = stubServer(pickyServer);
    await logs('b', item(1, 9999, at(1)));
    await finish('done');
    await flush();
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs']);
    const state = await syncState(SESSION);
    expect(state.status).toBe('not_saved');
    expect(state.held).toBeTruthy();
    await releaseHeld(SESSION);
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs', 'complete']);
  });

  it('Keep editing drops the held completion and reopens the workout on this device', async () => {
    stubServer(pickyServer);
    await cacheWorkout(detail());
    await logs('b', item(1, 9999, at(1)));
    await markFinished(SESSION, 'completed');
    await finish('done');
    await flush();
    await cancelFinish(SESSION);
    expect(await getAll<Mutation>('outbox')).toHaveLength(0);
    expect((await getCachedWorkout(SESSION))?.finished).toBeUndefined();
  });

  it('Keep editing, fix the refused set: its rejection clears and the workout then finishes', async () => {
    stubServer(pickyServer);
    await logs('b', item(1, 9999, at(1)));
    await finish('done');
    await flush();
    await cancelFinish(SESSION);
    // The client re-enters set 1, and this time the server accepts it.
    const accepting = stubServer((p, b) =>
      p.endsWith('/logs')
        ? ackAll(b)
        : { status: 200, body: { data: detail({ state: 'completed' }) } },
    );
    await logs('b2', item(1, 9, at(5)));
    await flush();
    expect(await syncState(SESSION)).toMatchObject({ status: 'synced', rejectedRows: {} });
    await finish('done-2');
    await flush();
    expect(accepting.calls.map((c) => c.path.split('/').pop())).toEqual(['logs', 'complete']);
    expect(await syncState(SESSION)).toMatchObject({ status: 'synced', held: undefined });
  });

  it('dismissing the refusal lets the held completion go out', async () => {
    const server = stubServer(pickyServer);
    await logs('b', item(1, 9999, at(1)));
    await finish('done');
    await flush();
    await dismissRejected(SESSION);
    await flush();
    expect(server.calls.map((c) => c.path.split('/').pop())).toEqual(['logs', 'complete']);
  });

  it('a rejected completion clears "finished" on the device and is reported', async () => {
    stubServer(() => ({
      status: 409,
      body: { error: { code: 'SESSION_FINISHED', message: 'This workout is already finished.' } },
    }));
    await cacheWorkout(detail());
    await markFinished(SESSION, 'completed');
    await finish('done');
    await flush();
    expect((await getCachedWorkout(SESSION))?.finished).toBeUndefined();
    expect(await syncState(SESSION)).toMatchObject({
      status: 'not_saved',
      rejected: [{ kind: 'complete', message: 'This workout is already finished.' }],
    });
  });

  it('finishing again replaces the earlier refused finish', async () => {
    stubServer(() => 'offline');
    await put<RejectedMutation>('rejected', {
      id: 'old',
      sessionId: SESSION,
      kind: 'complete',
      body: { idempotencyKey: 'old' },
      message: 'Refused.',
      rejectedAt: 0,
      ...OWNER,
    });
    await finish('again');
    expect((await syncState(SESSION)).rejected).toEqual([]);
  });
});
