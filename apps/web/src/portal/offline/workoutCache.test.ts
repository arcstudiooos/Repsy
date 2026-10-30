import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, flush } from './outbox';
import { ackAll, detail, freshDeviceStore, SESSION, stubServer, WVE } from './test-helpers';
import {
  applyLocal,
  cacheWorkout,
  evict,
  getCachedWorkout,
  localView,
  markFinished,
} from './workoutCache';

const set = (setIndex: number, reps: number, clientUpdatedAt: string) => ({
  workoutVersionExerciseId: WVE,
  setIndex,
  reps,
  weightKg: 60,
  rpe: null,
  durationSeconds: null,
  distanceM: null,
  clientUpdatedAt,
});

beforeEach(() => freshDeviceStore());
afterEach(() => vi.unstubAllGlobals());

describe('workoutCache', () => {
  it('localView prefers device values over the cached server payload', async () => {
    await cacheWorkout({ ...detail(), logs: [set(0, 5, '2026-11-04T10:00:00.000Z')] });
    await applyLocal(SESSION, [
      set(0, 8, '2026-11-04T10:05:00.000Z'),
      set(1, 6, '2026-11-04T10:06:00.000Z'),
    ]);
    // An older server payload arriving later (a cached page) never wins over the device's values.
    await cacheWorkout({ ...detail(), logs: [set(0, 3, '2026-11-04T09:00:00.000Z')] });
    const view = await localView(SESSION);
    expect(view?.logs.map((l) => [l.setIndex, l.reps])).toEqual([
      [0, 8],
      [1, 6],
    ]);
    expect(await localView('33333333-3333-4333-8333-333333333333')).toBeNull();
  });

  it('evict only when the outbox is empty', async () => {
    const server = stubServer(() => 'offline');
    await cacheWorkout(detail());
    expect(await evict(SESSION)).toBe(false); // still in progress
    await enqueue({
      id: 'k',
      sessionId: SESSION,
      kind: 'complete',
      body: { idempotencyKey: 'k' },
    });
    await markFinished(SESSION, 'completed');
    await flush();
    expect(server.offlineAttempts()).toBeGreaterThan(0);
    expect(await evict(SESSION)).toBe(false);
    expect(await getCachedWorkout(SESSION)).toBeDefined();

    stubServer((path, body) =>
      path.endsWith('/complete')
        ? { status: 200, body: { data: detail({ state: 'completed' }) } }
        : ackAll(body),
    );
    await new Promise((r) => setTimeout(r, 1100)); // past the first backoff
    await flush();
    expect(await evict(SESSION)).toBe(true);
    expect(await getCachedWorkout(SESSION)).toBeUndefined();
  });
});
