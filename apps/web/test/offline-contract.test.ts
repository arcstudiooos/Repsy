import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finishBodySchema, logsBodySchema } from '@kinetic/core';
import {
  sessionCompleteRoute,
  sessionSkipRoute,
  sessionStartRoute,
} from '../src/server/routes/workoutSessions';

/**
 * PRD M11: no hard lock-outs. A phone can hold writes queued by an older build (the IndexedDB outbox) for days, and an
 * open tab keeps running old JavaScript after a deploy. Those writes must still be accepted.
 *
 * These payloads are frozen copies of what the outbox sends today (outbox store v3, November 2026). Do not edit them
 * to make a change pass: keep accepting them for at least 90 days after the client stops sending them, and add a new
 * fixture for the new shape instead.
 */
const FROZEN = {
  start: {
    expectedWorkoutVersionId: 'a3c1e2d4-5b6f-4a7b-8c9d-0e1f2a3b4c5d',
    startedAt: '2026-11-05T06:30:00.000Z',
  },
  startBare: {},
  logs: {
    items: [
      {
        workoutVersionExerciseId: 'b4d2f3e5-6c7a-4b8c-9d0e-1f2a3b4c5d6e',
        setIndex: 0,
        reps: 8,
        weightKg: 62.5,
        rpe: 7.5,
        durationSeconds: null,
        distanceM: null,
        clientUpdatedAt: '2026-11-05T06:41:12.345Z',
        clientMutationId: 'c5e3a4f6-7d8b-4c9d-8e1f-2a3b4c5d6e7f',
      },
      {
        workoutVersionExerciseId: 'b4d2f3e5-6c7a-4b8c-9d0e-1f2a3b4c5d6e',
        setIndex: 1,
        reps: null,
        weightKg: null,
        rpe: null,
        durationSeconds: 45,
        distanceM: 0,
        clientUpdatedAt: '2026-11-05T06:43:00+05:30',
        clientMutationId: 'd6f4b5a7-8e9c-4d0e-9f2a-3b4c5d6e7f80',
      },
    ],
  },
  complete: { idempotencyKey: 'e7a5c6b8-9f0d-4e1f-8a3b-4c5d6e7f8091', comment: 'Felt strong' },
  skip: { idempotencyKey: 'f8b6d7c9-0a1e-4f2a-9b4c-5d6e7f809102' },
};

const API = join(__dirname, '../src/app/api/v1/sessions/[id]');

describe('offline write contract (M11)', () => {
  it('accepts the start payloads an older build queues', () => {
    expect(sessionStartRoute.input!.safeParse(FROZEN.start).success).toBe(true);
    expect(sessionStartRoute.input!.safeParse(FROZEN.startBare).success).toBe(true);
  });

  it('accepts the set-log payloads an older build queues', () => {
    const parsed = logsBodySchema.safeParse(FROZEN.logs);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('accepts the complete and skip payloads an older build queues', () => {
    expect(finishBodySchema.safeParse(FROZEN.complete).success).toBe(true);
    expect(sessionCompleteRoute.input!.safeParse(FROZEN.complete).success).toBe(true);
    expect(sessionSkipRoute.input!.safeParse(FROZEN.skip).success).toBe(true);
  });

  it('keeps every endpoint the outbox posts to', () => {
    for (const kind of ['start', 'logs', 'complete', 'skip']) {
      const file = join(API, kind, 'route.ts');
      expect(existsSync(file), `${kind} route`).toBe(true);
      expect(readFileSync(file, 'utf8')).toMatch(/export const POST\b/);
    }
  });
});
