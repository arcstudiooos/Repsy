import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import {
  BENCH,
  commitClientCopyVersion,
  newClientWorld,
  newOrg,
  PRESS,
  runAs,
  sessionsOf,
} from './fixtures.test-helpers';
import { resolveSessionWorkout } from './resolve';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('resolveSessionWorkout', () => {
  it('unstarted session reflects a newly committed version (D-002 #5)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [first] = await sessionsOf(prisma, w.assignmentId);
    const before = await runAs(prisma, w.coach, (tx) => resolveSessionWorkout(tx, first!.id));
    expect(before).toMatchObject({ title: 'W1D1', locked: false });

    const newId = await commitClientCopyVersion(prisma, w, 'Heavier day');
    const after = await runAs(prisma, w.coach, (tx) => resolveSessionWorkout(tx, first!.id));
    expect(after).toMatchObject({ workoutVersionId: newId, title: 'Heavier day', locked: false });
    expect(after.exercises.map((e) => e.sets)).toEqual([[{ reps: 3, loadKg: 120 }]]);
  });

  it('locked session keeps its version after a new commit (D-002 #6)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [first] = await sessionsOf(prisma, w.assignmentId);
    const original = await runAs(prisma, w.coach, (tx) => resolveSessionWorkout(tx, first!.id));
    await withSystem(
      (tx) =>
        tx.workoutSession.update({
          where: { id: first!.id },
          data: { workoutVersionId: original.workoutVersionId, state: 'in_progress' },
        }),
      prisma,
    );
    await commitClientCopyVersion(prisma, w, 'Changed later');
    const locked = await runAs(prisma, w.client, (tx) => resolveSessionWorkout(tx, first!.id));
    expect(locked).toMatchObject({
      workoutVersionId: original.workoutVersionId,
      title: 'W1D1',
      locked: true,
    });
  });

  it('exercises come in position order with instructions and tracking type', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [first] = await sessionsOf(prisma, w.assignmentId);
    const view = await runAs(prisma, w.client, (tx) => resolveSessionWorkout(tx, first!.id));
    expect(view.exercises.map((e) => [e.position, e.exerciseId, e.trackingType])).toEqual([
      [0, BENCH, 'reps_load'],
      [1, PRESS, 'reps_load'],
    ]);
    expect(view.exercises[0]!.name).toBe('Barbell Bench Press');
    expect(view.exercises[0]!.instructions.length).toBeGreaterThan(10);
    expect(view.exercises[0]!.sets).toEqual([
      { reps: 8, loadKg: 60 },
      { reps: 8, loadKg: 60 },
    ]);
  });

  it("another org's session id is NOT_FOUND", async () => {
    const a = await newClientWorld(prisma, await newOrg(prisma));
    const b = await newClientWorld(prisma, await newOrg(prisma));
    const [bSession] = await sessionsOf(prisma, b.assignmentId);
    const err = await runAs(prisma, a.coach, (tx) => resolveSessionWorkout(tx, bSession!.id)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('NOT_FOUND');
    const junk = await runAs(prisma, a.coach, (tx) => resolveSessionWorkout(tx, 'nope')).catch(
      (e: unknown) => e,
    );
    expect((junk as DomainError).code).toBe('NOT_FOUND');
  });
});
