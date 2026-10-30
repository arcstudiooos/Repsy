import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAll } from './db';
import { enqueue, flush, retryBlocked, subscribe, syncState, type Mutation } from './outbox';
import { ackAll, freshDeviceStore, item, SESSION, stubServer } from './test-helpers';

const T0 = new Date('2026-11-04T12:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000).toISOString();
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

const logs = (id: string, ...items: ReturnType<typeof item>[]) =>
  enqueue({ id, sessionId: SESSION, kind: 'logs', body: { items } });

beforeEach(() => {
  freshDeviceStore();
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

  it('clock-skew 422 blocks and keeps items until retryBlocked', async () => {
    let skewed = true;
    const clock = "The device clock is ahead of the server's. Check its date and time.";
    const server = stubServer((_p, body) =>
      skewed
        ? {
            status: 422,
            body: {
              error: {
                code: 'VALIDATION',
                message: 'Some fields are invalid.',
                fieldErrors: { items: [clock] },
              },
            },
          }
        : ackAll(body),
    );
    await logs('m', item(0, 8, at(1)));
    expect(await flush()).toMatchObject({ blocked: 1, pending: 0 });
    expect(await syncState(SESSION)).toMatchObject({
      status: 'saved_on_device',
      blockedReason: clock,
    });
    later(120_000);
    await flush();
    expect(server.calls).toHaveLength(1);

    skewed = false;
    await retryBlocked(SESSION);
    expect(server.calls).toHaveLength(2);
    expect(await syncState(SESSION)).toMatchObject({ status: 'synced', blockedReason: undefined });
  });

  it('409 moves the item to rejected and reports the message', async () => {
    stubServer(() => ({
      status: 409,
      body: { error: { code: 'SESSION_FINISHED', message: 'This workout is already finished.' } },
    }));
    await logs('m', item(0, 8, at(1)));
    expect(await flush()).toMatchObject({ sent: 0, pending: 0, rejected: 1 });
    expect(await getAll('outbox')).toHaveLength(0);
    expect(await syncState(SESSION)).toMatchObject({
      status: 'synced',
      rejected: [{ message: 'This workout is already finished.' }],
    });
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
});
