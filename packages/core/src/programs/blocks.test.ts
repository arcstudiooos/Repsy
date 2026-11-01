import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { blockLayout, describeBlock } from './blocks';
import { commitProgramVersion, type ExerciseInput } from './commit';
import { createProgram, getProgram } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let actor: ActorContext;
const BENCH = 'e0000000-0000-4000-8000-000000000001';
const PRESS = 'e0000000-0000-4000-8000-000000000002';
const PLANK = 'e0000000-0000-4000-8000-000000000065';

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  const user = await withSystem(
    (tx) => tx.user.create({ data: { email: 'blk@example.test', name: 'B' } }),
    prisma,
  );
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: user.id } }),
    prisma,
  );
  actor = { userId: user.id, orgId: org.id, role: 'owner', isPlatformAdmin: false };
});
afterAll(async () => {
  await drop();
});

const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });
const day = (exercises: ExerciseInput[]) => [{ days: [{ title: 'Day 1', exercises }] }];

describe('workout blocks (PRD C8)', () => {
  it('labels blocks A, B1, B2 and describes each format', () => {
    expect(blockLayout([{}, {}])).toEqual([
      { label: null, heading: null },
      { label: null, heading: null },
    ]);
    expect(
      blockLayout([
        {},
        { block: { format: 'superset', rounds: 3 } },
        { groupWithPrevious: true },
        { groupWithPrevious: true },
        { block: { format: 'emom', minutes: 10 } },
      ]),
    ).toEqual([
      { label: 'A', heading: null },
      { label: 'B1', heading: 'B · Superset · 3 rounds' },
      { label: 'B2', heading: null },
      { label: 'B3', heading: null },
      { label: 'C', heading: 'C · EMOM 10 min' },
    ]);
    // Joined without a spec: a superset.
    expect(blockLayout([{}, { groupWithPrevious: true }])[0]!.heading).toBe('A · Superset');
    expect(describeBlock({ format: 'interval', rounds: 8, workSec: 40, restSec: 20 })).toBe(
      'Intervals · 40 s on / 20 s off × 8',
    );
    expect(describeBlock({ format: 'for_time', rounds: 3, minutes: 20 })).toBe(
      'For time · 3 rounds (cap 20 min)',
    );
    expect(describeBlock({ format: 'amrap', minutes: 12 })).toBe('AMRAP 12 min');
  });

  it('saves and reads blocks; rejects a join at the top, a spec inside a block and missing settings', async () => {
    const program = await run((tx) => createProgram(tx, actor, { title: 'Blocks' }));
    const commit = (exercises: ExerciseInput[], expectedVersionNo: number | null) =>
      run((tx) =>
        commitProgramVersion(tx, actor, {
          programId: program.id,
          expectedVersionNo,
          weeks: day(exercises),
        }),
      );
    await commit(
      [
        { exerciseId: BENCH, block: { format: 'circuit', rounds: 3 }, sets: [{ reps: 8 }] },
        { exerciseId: PRESS, groupWithPrevious: true, sets: [{ reps: 10 }] },
        { exerciseId: PLANK, sets: [{ durationSec: 30 }] },
      ],
      null,
    );
    const ex = (await run((tx) => getProgram(tx, actor, program.id))).weeks[0]!.days[0]!.exercises;
    expect(ex.map((e) => [e.groupWithPrevious, e.block])).toEqual([
      [false, { format: 'circuit', rounds: 3 }],
      [true, null],
      [false, null],
    ]);

    for (const bad of [
      [{ exerciseId: BENCH, groupWithPrevious: true, sets: [{ reps: 8 }] }],
      [
        { exerciseId: BENCH, sets: [{ reps: 8 }] },
        {
          exerciseId: PRESS,
          groupWithPrevious: true,
          block: { format: 'superset' as const },
          sets: [{ reps: 8 }],
        },
      ],
      [
        {
          exerciseId: BENCH,
          block: { format: 'interval' as const, rounds: 8 },
          sets: [{ reps: 8 }],
        },
      ],
    ] as ExerciseInput[][]) {
      await expect(commit(bad, 1)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
});
