import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { commitProgramVersion, type DayInput, type WeekInput } from './commit';
import { createProgram, getProgram, renameProgram } from './read';
import {
  grid as worldGrid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;

const BENCH = 'e0000000-0000-4000-8000-000000000001'; // reps_load, global
const PLANK = 'e0000000-0000-4000-8000-000000000065'; // duration, global
const RUN = 'e0000000-0000-4000-8000-000000000077'; // distance, global

async function newActor(): Promise<ActorContext> {
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: coachId } }),
    prisma,
  );
  return { userId: coachId, orgId: org.id, role: 'owner', isPlatformAdmin: false };
}

const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : 'other'),
  );

/** weeks x days grid; every workout has a unique title unless `over` changes it. */
function grid(
  weeks: number,
  days: number,
  over: (w: number, d: number) => Partial<DayInput> = () => ({}),
): WeekInput[] {
  return Array.from({ length: weeks }, (_, w) => ({
    days: Array.from({ length: days }, (_, d) => ({
      title: `W${w + 1}D${d + 1}`,
      exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }],
      ...over(w, d),
    })),
  }));
}

const lastCommitAudit = (actor: ActorContext, programId: string) =>
  run(actor, (tx) =>
    tx.auditEvent.findFirstOrThrow({
      where: { action: 'program.version_committed', objectId: programId },
      orderBy: { createdAt: 'desc' },
    }),
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  coachId = (
    await withSystem(
      (tx) => tx.user.create({ data: { email: 'c@example.test', name: 'C' } }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('commitProgramVersion', () => {
  it('4x3 program then change one workout creates exactly 1 new WorkoutVersion (12 slots: 11 reused + 1 new)', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const first = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(4, 3),
      }),
    );
    expect(first.versionNo).toBe(1);
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(12);

    const changed = grid(4, 3, (w, d) =>
      w === 2 && d === 1
        ? { exercises: [{ exerciseId: BENCH, sets: [{ reps: 10, loadKg: 62.5 }] }] }
        : {},
    );
    const second = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: 1, weeks: changed }),
    );
    expect(second.versionNo).toBe(2);
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(13);

    const slots = await run(actor, (tx) =>
      tx.programSlot.findMany({ where: { programVersionId: second.versionId } }),
    );
    const oldSlots = await run(actor, (tx) =>
      tx.programSlot.findMany({ where: { programVersionId: first.versionId } }),
    );
    const oldIds = new Set(oldSlots.map((s) => s.workoutVersionId));
    expect(slots).toHaveLength(12);
    expect(slots.filter((s) => oldIds.has(s.workoutVersionId))).toHaveLength(11);
    expect((await lastCommitAudit(actor, id)).metadataJson).toEqual({
      versionNo: 2,
      created: 1,
      reused: 11,
    });
  });

  it('unchanged recommit reuses all 12', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(4, 3),
      }),
    );
    const again = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: 1, weeks: grid(4, 3) }),
    );
    expect(again.versionNo).toBe(2);
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(12);
    expect((await lastCommitAudit(actor, id)).metadataJson).toEqual({
      versionNo: 2,
      created: 0,
      reused: 12,
    });
  });

  it('float noise in loadKg hashes equal to the clean value and reuses the workout version', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const weeks = (loadKg: number): WeekInput[] => [
      { days: [{ title: 'A', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5, loadKg }] }] }] },
    ];
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: weeks(0.3),
      }),
    );
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: 1,
        weeks: weeks(0.30000000000000004),
      }),
    );
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(1);
  });

  it('reuses a workout version from elsewhere in the lineage when content returns', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const a = grid(1, 1);
    const b = grid(1, 1, () => ({ title: 'Other' }));
    for (const [expectedVersionNo, weeks] of [
      [null, a],
      [1, b],
      [2, a],
    ] as const) {
      await run(actor, (tx) =>
        commitProgramVersion(tx, actor, { programId: id, expectedVersionNo, weeks }),
      );
    }
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(2);
  });

  it('duplicate week produces new slots sharing workout versions', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const first = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(2, 3),
      }),
    );
    // The builder's "Duplicate week" on week 1: its copy is inserted after it and week 2 shifts to week 3.
    const [w1, w2] = grid(2, 3);
    const second = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: 1,
        weeks: [w1!, structuredClone(w1!), w2!],
      }),
    );
    const slotsOf = (versionId: string) =>
      run(actor, (tx) =>
        tx.programSlot.findMany({
          where: { programVersionId: versionId },
          orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
        }),
      );
    const before = await slotsOf(first.versionId);
    const after = await slotsOf(second.versionId);
    expect(after).toHaveLength(9);
    const ids = (rows: typeof after, week: number) =>
      rows.filter((s) => s.weekIndex === week).map((s) => s.workoutVersionId);
    expect(ids(after, 0)).toEqual(ids(before, 0));
    expect(ids(after, 1)).toEqual(ids(before, 0));
    expect(ids(after, 2)).toEqual(ids(before, 1));
    expect(await run(actor, (tx) => tx.workoutVersion.count())).toBe(6);
    expect((await lastCommitAudit(actor, id)).metadataJson).toEqual({
      versionNo: 2,
      created: 0,
      reused: 9,
    });
  });

  it('stale expectedVersionNo -> CONFLICT with currentVersionNo', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 1),
      }),
    );
    const err = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 1),
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: 'CONFLICT', details: { currentVersionNo: 1 } });
    expect(await run(actor, (tx) => tx.programVersion.count())).toBe(1);
  });

  it('uneven days per week -> VALIDATION on weeks', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const weeks = [grid(1, 3)[0]!, grid(1, 2)[0]!];
    const err = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: null, weeks }),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as DomainError).fieldErrors?.weeks?.length).toBeGreaterThan(0);
  });

  it('a 52-week program commits (PRD C10: up to 104 weeks)', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'Year' }));
    const res = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(52, 4),
      }),
    );
    expect(res.versionNo).toBe(1);
  });

  it('bounds: 0 or 105 weeks, 8 days, 31 exercises, 0 exercises -> VALIDATION', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const ex = { exerciseId: BENCH, sets: [{ reps: 5 }] };
    for (const weeks of [
      [],
      grid(105, 1),
      grid(1, 8),
      grid(1, 1, () => ({ exercises: Array.from({ length: 31 }, () => ex) })),
      grid(1, 1, () => ({ exercises: [] })),
    ]) {
      expect(
        await code(
          run(actor, (tx) =>
            commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: null, weeks }),
          ),
        ),
      ).toBe('VALIDATION');
    }
    expect(await run(actor, (tx) => tx.programVersion.count())).toBe(0);
  });

  it('a set must carry the field its exercise tracks (duration without durationSec -> VALIDATION)', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const commit = (exerciseId: string, set: object) =>
      code(
        run(actor, (tx) =>
          commitProgramVersion(tx, actor, {
            programId: id,
            expectedVersionNo: null,
            weeks: grid(1, 1, () => ({ exercises: [{ exerciseId, sets: [set] }] })),
          }),
        ),
      );
    expect(await commit(PLANK, { reps: 10 })).toBe('VALIDATION');
    expect(await commit(BENCH, { durationSec: 30 })).toBe('VALIDATION');
    expect(await commit(RUN, { durationSec: 30 })).toBe('VALIDATION');
    expect(await commit(PLANK, { durationSec: 30 })).toBe('ok');
  });

  it('exercise from another org -> NOT_FOUND; globals and own custom allowed', async () => {
    const a = await newActor();
    const b = await newActor();
    const custom = (actor: ActorContext, name: string) =>
      run(actor, (tx) =>
        tx.exercise.create({
          data: {
            name,
            equipment: 'x',
            muscleGroup: 'x',
            movementType: 'x',
            trackingType: 'reps_load',
          },
        }),
      );
    const foreign = await custom(b, 'B only');
    const own = await custom(a, 'A only');
    const { id } = await run(a, (tx) => createProgram(tx, a, { title: 'P' }));
    const commit = (exerciseId: string, expectedVersionNo: number | null) =>
      code(
        run(a, (tx) =>
          commitProgramVersion(tx, a, {
            programId: id,
            expectedVersionNo,
            weeks: grid(1, 1, () => ({ exercises: [{ exerciseId, sets: [{ reps: 5 }] }] })),
          }),
        ),
      );
    expect(await commit(foreign.id, null)).toBe('NOT_FOUND');
    expect(await commit(BENCH, null)).toBe('ok'); // globals allowed
    expect(await commit(own.id, 1)).toBe('ok');
  });

  it('old version still renders after a new commit', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    const v1 = await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(2, 2),
      }),
    );
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: 1,
        weeks: grid(2, 2, (w, d) => (w === 0 && d === 0 ? { title: 'Changed' } : {})),
      }),
    );
    const old = await run(actor, (tx) => getProgram(tx, actor, id, { versionId: v1.versionId }));
    expect(old.versionNo).toBe(1);
    expect(old.weeks[0]?.days[0]?.title).toBe('W1D1');
    const latest = await run(actor, (tx) => getProgram(tx, actor, id));
    expect(latest.versionNo).toBe(2);
    expect(latest.weeks[0]?.days[0]?.title).toBe('Changed');
    expect(latest).toMatchObject({ daysPerWeek: 2, weekCount: 2 });
    expect(latest.weeks[0]?.days[0]?.exercises[0]).toMatchObject({
      exerciseId: BENCH,
      exerciseName: 'Barbell Bench Press',
      trackingType: 'reps_load',
      sets: [{ reps: 8, loadKg: 60 }],
    });
  });

  it("another org's program -> NOT_FOUND; client role -> FORBIDDEN; bad id -> NOT_FOUND", async () => {
    const a = await newActor();
    const b = await newActor();
    const { id } = await run(a, (tx) => createProgram(tx, a, { title: 'P' }));
    expect(await code(run(b, (tx) => getProgram(tx, b, id)))).toBe('NOT_FOUND');
    expect(
      await code(
        run(b, (tx) =>
          commitProgramVersion(tx, b, {
            programId: id,
            expectedVersionNo: null,
            weeks: grid(1, 1),
          }),
        ),
      ),
    ).toBe('NOT_FOUND');
    const asClient = { ...a, role: 'client' as const };
    expect(await code(run(a, (tx) => getProgram(tx, asClient, id)))).toBe('FORBIDDEN');
    expect(await code(run(a, (tx) => getProgram(tx, a, 'not-a-uuid')))).toBe('NOT_FOUND');
  });

  it('a commit that starts while another is in flight waits on the program lock, then conflicts', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));

    const first = run(actor, async (tx) => {
      const out = await commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 1),
      });
      locked();
      await held; // keep the transaction (and the row lock) open
      return out;
    });
    await hasLock;
    const second = run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 1, () => ({ title: 'Other' })),
      }),
    ).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300)); // let the second reach the lock
    release();
    expect((await first).versionNo).toBe(1);
    const err = await second;
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: 'CONFLICT', details: { currentVersionNo: 1 } });
    expect(await run(actor, (tx) => tx.programVersion.count())).toBe(1);
  });

  it('workout version rows are immutable: committed content is never rewritten', async () => {
    const actor = await newActor();
    const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'P' }));
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: null,
        weeks: grid(1, 1),
      }),
    );
    const before = await run(actor, (tx) =>
      tx.workoutVersionExercise.findMany({ orderBy: { position: 'asc' } }),
    );
    await run(actor, (tx) =>
      commitProgramVersion(tx, actor, {
        programId: id,
        expectedVersionNo: 1,
        weeks: grid(1, 1, () => ({ exercises: [{ exerciseId: BENCH, sets: [{ reps: 3 }] }] })),
      }),
    );
    const after = await run(actor, (tx) =>
      tx.workoutVersionExercise.findMany({ where: { id: { in: before.map((r) => r.id) } } }),
    );
    expect(after).toEqual(before);
  });

  it('a client copy without an active assignment cannot be committed or renamed (CONFLICT)', async () => {
    const actor = await newActor();
    const copy = await run(actor, (tx) =>
      tx.program.create({
        data: { title: 'Copy', kind: 'client', createdBy: actor.userId },
      } as Parameters<typeof tx.program.create>[0]),
    );
    expect(
      await code(
        run(actor, (tx) =>
          commitProgramVersion(tx, actor, {
            programId: copy.id,
            expectedVersionNo: null,
            weeks: grid(1, 1),
          }),
        ),
      ),
    ).toBe('CONFLICT');
    expect(await code(run(actor, (tx) => renameProgram(tx, actor, copy.id, 'New')))).toBe(
      'CONFLICT',
    );
    const row = await run(actor, (tx) => tx.program.findFirstOrThrow({ where: { id: copy.id } }));
    expect(row).toMatchObject({ title: 'Copy', currentVersionId: null });
    expect(await run(actor, (tx) => tx.programVersion.count())).toBe(0);
    // Still readable (assignment summaries need it).
    expect((await run(actor, (tx) => getProgram(tx, actor, copy.id))).kind).toBe('client');
  });
});

describe('commitProgramVersion on client copies (S3-2)', () => {
  const versionOf = (w: ClientWorld, programId = w.clientProgramId) =>
    withSystem(
      async (tx) =>
        (
          await tx.program.findUniqueOrThrow({
            where: { id: programId },
            select: { currentVersion: { select: { versionNo: true } } },
          })
        ).currentVersion?.versionNo ?? null,
      prisma,
    );
  const commitAs = async (w: ClientWorld, weeks: WeekInput[], programId = w.clientProgramId) => {
    const expectedVersionNo = await versionOf(w, programId);
    return runAs(prisma, w.coach, (tx) =>
      commitProgramVersion(tx, w.coach, { programId, expectedVersionNo, weeks }, { now: NOW }),
    );
  };
  const strip = (rows: Awaited<ReturnType<typeof sessionsOf>>) =>
    rows.map(({ id, state, scheduledAt, dueAt, workoutVersionId }) => ({
      id,
      state,
      scheduledAt,
      dueAt,
      workoutVersionId,
    }));

  it('client copy commit reconciles and audits counts', async () => {
    // Two weeks of Mon/Wed/Fri; the commit adds a third week.
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: worldGrid(2, 3) });
    const res = await commitAs(w, worldGrid(3, 3));
    expect(res.versionNo).toBe(2);
    const rows = await sessionsOf(prisma, w.assignmentId);
    expect(rows).toHaveLength(9);
    expect(rows.filter((s) => s.slotWeekIndex === 2).every((s) => s.state === 'scheduled')).toBe(
      true,
    );
    const audit = await runAs(prisma, w.coach, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { action: 'program.version_committed', objectId: w.clientProgramId },
      }),
    );
    expect(audit.metadataJson).toEqual({
      versionNo: 2,
      created: 3,
      reused: 6,
      slotsAdded: 3,
      slotsRemoved: 0,
      sessionsCancelled: 0,
      sessionsCreated: 3,
    });

    await commitAs(w, worldGrid(1, 3));
    const latest = await runAs(prisma, w.coach, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { action: 'program.version_committed', objectId: w.clientProgramId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(latest.metadataJson).toMatchObject({
      versionNo: 3,
      slotsAdded: 0,
      slotsRemoved: 6,
      sessionsCancelled: 6,
      sessionsCreated: 0,
    });
  });

  it('client copy days-per-week change → VALIDATION weeks', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: worldGrid(1, 3) });
    const err = await commitAs(w, worldGrid(1, 2)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        weeks: ['A client program keeps 3 training days per week, one per scheduled weekday.'],
      },
    });
    expect(await versionOf(w)).toBe(1);
  });

  it('client copy: a stale expectedVersion wins over a days-per-week change → CONFLICT', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: worldGrid(1, 3) });
    await commitAs(w, worldGrid(2, 3)); // another tab moved the copy to version 2
    const err = await runAs(prisma, w.coach, (tx) =>
      commitProgramVersion(
        tx,
        w.coach,
        { programId: w.clientProgramId, expectedVersionNo: 1, weeks: worldGrid(1, 2) },
        { now: NOW },
      ),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'CONFLICT', details: { currentVersionNo: 2 } });
  });

  it('copy of ended assignment → CONFLICT', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await withSystem(
      (tx) =>
        tx.programAssignment.update({
          where: { id: w.assignmentId },
          data: { status: 'ended', endedAt: NOW },
        }),
      prisma,
    );
    const before = strip(await sessionsOf(prisma, w.assignmentId));
    expect(await code(commitAs(w, worldGrid(2, 3)))).toBe('CONFLICT');
    expect(strip(await sessionsOf(prisma, w.assignmentId))).toEqual(before);
    expect(await versionOf(w)).toBe(1);
  });

  it('renameProgram renames an editable client copy (the PATCH title+weeks path) and audits it', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) =>
      renameProgram(tx, w.coach, w.clientProgramId, '  Client block  '),
    );
    const titles = await withSystem(
      (tx) =>
        tx.program.findMany({
          where: { id: { in: [w.clientProgramId, w.templateId] } },
          select: { id: true, title: true },
        }),
      prisma,
    );
    expect(titles.find((p) => p.id === w.clientProgramId)?.title).toBe('Client block');
    // The template it was copied from keeps its title.
    expect(titles.find((p) => p.id === w.templateId)?.title).not.toBe('Client block');
    const audit = await runAs(prisma, w.coach, (tx) =>
      tx.auditEvent.findFirst({
        where: { action: 'program.renamed', objectId: w.clientProgramId },
      }),
    );
    expect(audit).not.toBeNull();
  });

  it('renameProgram: another org cannot rename a client copy (NOT_FOUND)', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newOrg(prisma);
    expect(
      await code(
        runAs(prisma, other.coach, (tx) =>
          renameProgram(tx, other.coach, w.clientProgramId, 'Hijack'),
        ),
      ),
    ).toBe('NOT_FOUND');
  });

  it('template commit still never touches sessions', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma), { weeks: worldGrid(2, 3) });
    const before = strip(await sessionsOf(prisma, w.assignmentId));
    const res = await commitAs(w, worldGrid(1, 2), w.templateId);
    expect(res.versionNo).toBe(2);
    expect(strip(await sessionsOf(prisma, w.assignmentId))).toEqual(before);
    const audit = await runAs(prisma, w.coach, (tx) =>
      tx.auditEvent.findFirstOrThrow({
        where: { action: 'program.version_committed', objectId: w.templateId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(Object.keys(audit.metadataJson as object).sort()).toEqual([
      'created',
      'reused',
      'versionNo',
    ]);
  });
});
