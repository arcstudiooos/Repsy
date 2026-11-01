import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { getSessionDetail } from './detail';
import { newClientWorld, newOrg, runAs, sessionsOf } from './fixtures.test-helpers';
import { startSession } from './lifecycle';
import { addSessionNote } from './notes';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('notes on sets and workouts (PRD D9)', () => {
  it('client and coach add notes in order; they cannot be edited; scoping and validation hold', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [s] = await sessionsOf(prisma, w.assignmentId);
    // Not started: nothing to attach to yet.
    await expect(
      runAs(prisma, w.client, (tx) =>
        addSessionNote(tx, w.client, s!.id, {
          workoutVersionExerciseId: '00000000-0000-4000-8000-000000000000',
          body: 'x',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, s!.id));
    const bench = detail.workout.exercises[0]!.id;
    const mine = await runAs(prisma, w.client, (tx) =>
      addSessionNote(tx, w.client, s!.id, {
        workoutVersionExerciseId: bench,
        setIndex: 1,
        body: '  Grip slipped on set 2  ',
      }),
    );
    expect(mine).toMatchObject({
      setIndex: 1,
      body: 'Grip slipped on set 2',
      authorRole: 'client',
    });
    const reply = await runAs(prisma, w.coach, (tx) =>
      addSessionNote(tx, w.coach, s!.id, {
        workoutVersionExerciseId: bench,
        body: 'Try chalk next time.',
      }),
    );
    expect(reply).toMatchObject({ setIndex: null, authorRole: 'coach', authorName: 'Coach' });
    const seen = await runAs(prisma, w.client, (tx) => getSessionDetail(tx, w.client, s!.id));
    expect(seen.notes?.map((n) => n.body)).toEqual([
      'Grip slipped on set 2',
      'Try chalk next time.',
    ]);

    const field = (input: Parameters<typeof addSessionNote>[3]) =>
      runAs(prisma, w.client, (tx) => addSessionNote(tx, w.client, s!.id, input)).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(await field({ workoutVersionExerciseId: bench, body: '   ' })).toBe('body');
    expect(await field({ workoutVersionExerciseId: bench, body: 'x'.repeat(501) })).toBe('body');
    expect(await field({ workoutVersionExerciseId: bench, body: 'ok', setIndex: 25 })).toBe(
      'setIndex',
    );

    // Another client cannot reach it.
    const other = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, other.client, (tx) =>
        addSessionNote(tx, other.client, s!.id, { workoutVersionExerciseId: bench, body: 'hi' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Immutable in the database too.
    await expect(
      withSystem(
        (tx) => tx.sessionNote.update({ where: { id: mine.id }, data: { body: 'edited' } }),
        prisma,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withSystem((tx) => tx.sessionNote.delete({ where: { id: mine.id } }), prisma),
    ).rejects.toThrow(/append-only/);
  });
});
