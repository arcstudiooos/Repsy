/** Shared by the offline unit tests (not a test file itself). */
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { SessionDetail } from '@kinetic/core';
import type { SetLogPayload } from '@/lib/workout-api';
import { bindOwner, resetDbForTests, type DeviceOwner } from './db';

export const OWNER: DeviceOwner = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
};

/** A fresh, empty device store, bound to `owner` (the portal layout's job in the app). */
export async function freshDeviceStore(owner: DeviceOwner | null = OWNER): Promise<void> {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  if (owner) await bindOwner(owner);
}

/** A minimal Cache Storage (Node has none): just the cache names, for the sign-out and owner tests. */
export function stubCaches(names: string[]) {
  const live = new Set(names);
  vi.stubGlobal('caches', {
    keys: async () => [...live],
    delete: async (name: string) => live.delete(name),
  });
  return live;
}

export const SESSION = '11111111-1111-4111-8111-111111111111';
export const WVE = '22222222-2222-4222-8222-222222222222';

export const detail = (over: Partial<SessionDetail['session']> = {}): SessionDetail =>
  ({
    session: { id: SESSION, state: 'in_progress', ...over },
    workout: { exercises: [] },
    logs: [],
    previous: {},
    client: { id: 'c', name: 'C', preferredUnits: 'kg', timezone: 'UTC' },
    revisions: [],
    editableUntil: null,
  }) as unknown as SessionDetail;

export const item = (setIndex: number, reps: number, at: string): SetLogPayload => ({
  workoutVersionExerciseId: WVE,
  setIndex,
  reps,
  weightKg: 60,
  rpe: null,
  durationSeconds: null,
  distanceM: null,
  clientUpdatedAt: at,
  clientMutationId: crypto.randomUUID(),
});

type Reply =
  { status: number; body: unknown } | 'offline' | Promise<{ status: number; body: unknown }>;

/**
 * A stubbed `fetch`: `reply` decides each answer. Calls that reached the "server" are recorded as
 * `{ path, body }`; offline attempts are counted separately.
 */
export function stubServer(reply: (path: string, body: unknown) => Reply) {
  const calls: { path: string; body: unknown }[] = [];
  let offlineAttempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown;
      const r = reply(url, body);
      if (r === 'offline') {
        offlineAttempts += 1;
        throw new TypeError('Failed to fetch');
      }
      calls.push({ path: url, body });
      const { status, body: json } = await r;
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { calls, offlineAttempts: () => offlineAttempts };
}

/** The server's ack for a logs batch: every item saved. */
export const ackAll = (body: unknown) => ({
  status: 200,
  body: {
    data: (body as { items: SetLogPayload[] }).items.map((i) => ({
      workoutVersionExerciseId: i.workoutVersionExerciseId,
      setIndex: i.setIndex,
      clientMutationId: i.clientMutationId,
      status: 'saved',
      value: {
        reps: i.reps,
        weightKg: i.weightKg,
        rpe: i.rpe,
        durationSeconds: i.durationSeconds,
        distanceM: i.distanceM,
        clientUpdatedAt: i.clientUpdatedAt,
      },
    })),
  },
});
