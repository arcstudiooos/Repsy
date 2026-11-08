import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import { completeSession, startSession } from '../sessions/lifecycle';
import { getSessionDetail } from '../sessions/detail';
import {
  BENCH,
  newClientWorld,
  newOrg,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { fromDisplay, toDisplay } from '../units';
import { upsertSetLogs } from './upsertSetLogs';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );
const logRows = (sessionId: string) =>
  withSystem(
    (tx) => tx.setLog.findMany({ where: { sessionId }, orderBy: { setIndex: 'asc' } }),
    prisma,
  );

/** A started session and its two exercise row ids (bench, press). */
async function started(w: ClientWorld, index = 0) {
  const id = (await sessionsOf(prisma, w.assignmentId))[index]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  return { id, bench: detail.workout.exercises[0]!.id, press: detail.workout.exercises[1]!.id };
}

/** Device timestamps an hour back, so they never trip the clock-skew guard. */
const at = (minutes: number) => new Date(Date.now() - 3_600_000 + minutes * 60_000).toISOString();
const T0 = at(0);

const item = (wve: string, setIndex: number, over: Record<string, unknown> = {}) => ({
  workoutVersionExerciseId: wve,
  setIndex,
  reps: 8,
  weightKg: 60,
  clientUpdatedAt: T0,
  clientMutationId: randomUUID(),
  ...over,
});

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('upsertSetLogs', () => {
  it('same payload x3 → one row per set (Review Focus #2)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await started(w);
    const batch = [
      item(s.bench, 0),
      item(s.bench, 1),
      item(s.press, 0, { reps: 5, weightKg: 100 }),
    ];
    for (let i = 0; i < 3; i++) {
      const acks = await runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, s.id, batch));
      expect(acks.map((a) => a.status)).toEqual(['saved', 'saved', 'saved']);
    }
    // Concurrent replays too.
    await Promise.all(
      [1, 2, 3].map(() =>
        runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, s.id, batch)),
      ),
    );
    expect((await logRows(s.id)).length).toBe(3);
  });

  it('older clientUpdatedAt is ignored with a stale ack; newer overwrites; omitted fields are kept', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await started(w);
    await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0, { reps: 8, rpe: 8 })]),
    );
    const [stale] = await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0, { reps: 3, clientUpdatedAt: at(-1) })]),
    );
    expect(stale).toMatchObject({ status: 'stale', value: { reps: 8 } });
    const newer = item(s.bench, 0, { clientUpdatedAt: at(1) });
    delete (newer as Record<string, unknown>).weightKg;
    const [fresh] = await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, s.id, [{ ...newer, reps: 10 }]),
    );
    expect(fresh).toMatchObject({ status: 'saved', value: { reps: 10, weightKg: 60, rpe: 8 } });
    const [cleared] = await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0, { rpe: null, clientUpdatedAt: at(2) })]),
    );
    expect(cleared!.value.rpe).toBeNull();
  });

  it('an exercise not in the locked version is a VALIDATION error and nothing is written', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const s = await started(w);
    // Same org, another client's version; and a session the client hasn't started.
    const other = await newClientWorld(prisma, org);
    const theirs = await started(other);
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0), item(theirs.bench, 0)]),
        ),
      ),
    ).toBe('VALIDATION');
    // Another org's exercise row.
    const far = await newClientWorld(prisma, await newOrg(prisma));
    const farS = await started(far);
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, s.id, [item(farS.bench, 0)])),
      ),
    ).toBe('VALIDATION');
    expect(await logRows(s.id)).toEqual([]);
    // And logging into the other client's session is NOT_FOUND.
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          upsertSetLogs(tx, w.client, theirs.id, [item(theirs.bench, 0)]),
        ),
      ),
    ).toBe('NOT_FOUND');
  });

  it('before start → SESSION_NOT_STARTED; after complete → SESSION_FINISHED', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await started(w);
    const [, second] = await sessionsOf(prisma, w.assignmentId);
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) =>
          upsertSetLogs(tx, w.client, second!.id, [item(s.bench, 0)]),
        ),
      ),
    ).toBe('SESSION_NOT_STARTED');
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, s.id, { idempotencyKey: randomUUID() }),
    );
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0)])),
      ),
    ).toBe('SESSION_FINISHED');
  });

  it('validation bounds: rpe 11, weightKg 2000.001, reps 1001, set index 20, a future clock', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await started(w);
    for (const over of [
      { rpe: 11 },
      { rpe: 7.3 },
      { weightKg: 2000.001 },
      { reps: 1001 },
      { reps: 2.5 },
      { setIndex: 20 },
      { clientUpdatedAt: '2099-01-01T00:00:00.000Z' },
      { clientMutationId: 'nope' },
    ]) {
      expect(
        await codeOf(
          runAs(prisma, w.client, (tx) =>
            upsertSetLogs(tx, w.client, s.id, [{ ...item(s.bench, 0), ...over }]),
          ),
        ),
        JSON.stringify(over),
      ).toBe('VALIDATION');
    }
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => upsertSetLogs(tx, w.client, s.id, []))),
    ).toBe('VALIDATION');
  });

  it('units round-trip: 135 lb is stored as 61.235 kg and reads back as 135 lb / 61.2 kg (Review Focus #5)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const s = await started(w);
    const [ack] = await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, s.id, [item(s.bench, 0, { weightKg: fromDisplay(135, 'lb') })]),
    );
    expect(ack!.value.weightKg).toBe(61.235);
    const [stored] = await logRows(s.id);
    expect(stored!.weightKg!.toString()).toBe('61.235');
    const detail = await runAs(prisma, w.coach, (tx) => getSessionDetail(tx, w.coach, s.id));
    const kg = detail.logs[0]!.weightKg!;
    expect(toDisplay(kg, 'lb')).toBe(135);
    expect(toDisplay(kg, 'kg')).toBe(61.2);
  });
});

describe('getSessionDetail previous performance', () => {
  it('shows each exercise from the most recent other completed session', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const first = await started(w, 0);
    await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, first.id, [item(first.bench, 0, { reps: 6, weightKg: 70 })]),
    );
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, first.id, { idempotencyKey: randomUUID() }),
    );
    const second = (await sessionsOf(prisma, w.assignmentId))[1]!.id;
    const detail = await runAs(prisma, w.client, (tx) => getSessionDetail(tx, w.client, second));
    expect(detail.previous[BENCH]).toEqual({
      localDate: '2026-11-04',
      sets: [
        { setIndex: 0, reps: 6, weightKg: 70, rpe: null, durationSeconds: null, distanceM: null },
      ],
    });
    expect(detail.client.preferredUnits).toBe('kg');
    expect(detail.logs).toEqual([]);
    expect(detail.workout.locked).toBe(false);
  });

  it("never shows another client's sessions", async () => {
    const org = await newOrg(prisma);
    const me = await newClientWorld(prisma, org);
    const sibling = await newClientWorld(prisma, org);
    // The sibling completes bench; my detail must not show it.
    const theirs = await started(sibling, 0);
    await runAs(prisma, sibling.client, (tx) =>
      upsertSetLogs(tx, sibling.client, theirs.id, [item(theirs.bench, 0, { reps: 3 })]),
    );
    await runAs(prisma, sibling.client, (tx) =>
      completeSession(tx, sibling.client, theirs.id, { idempotencyKey: randomUUID() }),
    );
    const mine = (await sessionsOf(prisma, me.assignmentId))[1]!.id;
    const detail = await runAs(prisma, me.client, (tx) => getSessionDetail(tx, me.client, mine));
    expect(detail.previous).toEqual({});
  });
});
