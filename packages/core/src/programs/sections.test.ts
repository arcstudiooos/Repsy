import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { commitProgramVersion, contentHash } from './commit';
import { createProgram, getProgram } from './read';
import { sectionStart } from './sections';
import { parseProgramText } from './text-import';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let actor: ActorContext;
const BENCH = 'e0000000-0000-4000-8000-000000000001';
const PLANK = 'e0000000-0000-4000-8000-000000000065';

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  const user = await withSystem(
    (tx) => tx.user.create({ data: { email: 'sec@example.test', name: 'S' } }),
    prisma,
  );
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: user.id } }),
    prisma,
  );
  await withSystem(
    (tx) =>
      tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'owner' } }),
    prisma,
  );
  actor = { userId: user.id, orgId: org.id, role: 'owner', isPlatformAdmin: false };
});
afterAll(async () => {
  await drop();
});

const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

describe('workout sections (PRD C9)', () => {
  it('keeps the hash of an all-main workout unchanged', () => {
    const plain = {
      title: 'A',
      notes: '',
      exercises: [{ exerciseId: BENCH, note: null, sets: [{ reps: 5 }] }],
    };
    // The canonical JSON workouts were hashed from before sections existed: no section key.
    const before = createHash('sha256')
      .update(
        `{"exercises":[{"exerciseId":"${BENCH}","note":null,"sets":[{"reps":5}]}],"notes":"","title":"A"}`,
      )
      .digest('hex');
    expect(contentHash(plain)).toBe(before);
    expect(
      contentHash({ ...plain, exercises: [{ ...plain.exercises[0]!, section: 'warmup' }] }),
    ).not.toBe(contentHash(plain));
  });

  it('saves and reads sections; main is the default', async () => {
    const program = await run((tx) => createProgram(tx, actor, { title: 'Sections' }));
    await run((tx) =>
      commitProgramVersion(tx, actor, {
        programId: program.id,
        expectedVersionNo: null,
        weeks: [
          {
            days: [
              {
                title: 'Day 1',
                exercises: [
                  { exerciseId: PLANK, section: 'warmup', sets: [{ durationSec: 30 }] },
                  { exerciseId: BENCH, sets: [{ reps: 5 }] },
                  { exerciseId: PLANK, section: 'cooldown', sets: [{ durationSec: 60 }] },
                ],
              },
            ],
          },
        ],
      }),
    );
    const detail = await run((tx) => getProgram(tx, actor, program.id));
    const ex = detail.weeks[0]!.days[0]!.exercises;
    expect(ex.map((e) => e.section)).toEqual(['warmup', 'main', 'cooldown']);
    expect(ex.map((_, i) => sectionStart(ex, i))).toEqual(['Warm-up', 'Main', 'Cool-down']);

    await expect(
      run((tx) =>
        commitProgramVersion(tx, actor, {
          programId: program.id,
          expectedVersionNo: 1,
          weeks: [
            {
              days: [
                {
                  title: 'Day 1',
                  exercises: [
                    { exerciseId: BENCH, section: 'stretch' as never, sets: [{ reps: 5 }] },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('shows no labels on an all-main workout', () => {
    const items = [{ section: 'main' as const }, {}];
    expect(items.map((_, i) => sectionStart(items, i))).toEqual([null, null]);
  });

  it('reads section headings in pasted programs', () => {
    const p = parseProgramText(
      'Day 1: Upper\nWarm-up:\nPlank 2x30s\nMain\nBench press 3x5\nCool down:\nPlank 1x60s\nDay 2\nBench press 3x5',
    );
    expect(p.errors).toEqual([]);
    expect(p.weeks[0]!.days.map((d) => d.title)).toEqual(['Day 1: Upper', 'Day 2']);
    expect(p.weeks[0]!.days[0]!.lines.map((l) => l.section)).toEqual([
      'warmup',
      undefined,
      'cooldown',
    ]);
    expect(p.weeks[0]!.days[1]!.lines[0]!.section).toBeUndefined();
  });
});
