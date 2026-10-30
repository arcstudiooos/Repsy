import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { commitProgramVersion, type WeekInput } from '../programs/commit';
import { createProgram, getProgram } from '../programs/read';
import { assignProgram, getAssignmentSummary, getProgramAssignee } from './assign';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;

const BENCH = 'e0000000-0000-4000-8000-000000000001';
const NY = 'America/New_York';

interface World {
  actor: ActorContext;
  clientId: string;
  templateId: string;
}

type AssignInput = Parameters<typeof assignProgram>[2];

const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

const grid = (weeks: number, days: number, prefix = 'W'): WeekInput[] =>
  Array.from({ length: weeks }, (_, w) => ({
    days: Array.from({ length: days }, (_, d) => ({
      title: `${prefix}${w + 1}D${d + 1}`,
      exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }],
    })),
  }));

async function makeTemplate(actor: ActorContext, weeks = grid(2, 3)): Promise<string> {
  const { id } = await run(actor, (tx) => createProgram(tx, actor, { title: 'Template' }));
  await run(actor, (tx) =>
    commitProgramVersion(tx, actor, { programId: id, expectedVersionNo: null, weeks }),
  );
  return id;
}

async function world(opts: { clientStatus?: 'active' | 'invited' } = {}): Promise<World> {
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: NY, ownerUserId: coachId } }),
    prisma,
  );
  const actor: ActorContext = {
    userId: coachId,
    orgId: org.id,
    role: 'owner',
    isPlatformAdmin: false,
  };
  const client = await withSystem(
    (tx) =>
      tx.client.create({
        data: {
          organizationId: org.id,
          coachUserId: coachId,
          name: 'Cli',
          email: `c-${org.id}@example.test`,
          status: opts.clientStatus ?? 'active',
          timezone: NY,
        },
      }),
    prisma,
  );
  return { actor, clientId: client.id, templateId: await makeTemplate(actor) };
}

const input = (w: World, over: Partial<AssignInput> = {}): AssignInput => ({
  clientId: w.clientId,
  templateProgramId: w.templateId,
  startLocalDate: '2026-11-04',
  weekdays: [1, 3, 5],
  readinessConfirmed: true,
  confirmReplace: false,
  ...over,
});

/** Fixed clock: 2026-11-01 08:00 in New York, so the 2026-11-04 start dates stay in the future. */
const NOW = new Date('2026-11-01T13:00:00Z');

const assign = (w: World, over: Partial<AssignInput> = {}, now: Date = NOW) =>
  run(w.actor, (tx) => assignProgram(tx, w.actor, input(w, over), { now }));

const sessionsOf = (assignmentId: string) =>
  withSystem(
    (tx) =>
      tx.workoutSession.findMany({
        where: { assignmentId },
        orderBy: [{ slotWeekIndex: 'asc' }, { slotDayIndex: 'asc' }],
      }),
    prisma,
  );

const ymd = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  coachId = (
    await withSystem(
      (tx) => tx.user.create({ data: { email: 'coach@example.test', name: 'Coach' } }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('assignProgram', () => {
  it('assigning 2x3 template creates client program sharing workout versions and 6 sessions with correct dates', async () => {
    const w = await world();
    const before = await withSystem((tx) => tx.workoutVersion.count(), prisma);
    const res = await assign(w);
    expect(res.sessionCount).toBe(6);
    expect(await withSystem((tx) => tx.workoutVersion.count(), prisma)).toBe(before);

    const [tmpl, copy] = await withSystem(
      (tx) =>
        Promise.all([
          tx.program.findUniqueOrThrow({ where: { id: w.templateId } }),
          tx.program.findUniqueOrThrow({ where: { id: res.clientProgramId } }),
        ]),
      prisma,
    );
    expect(copy).toMatchObject({
      kind: 'client',
      clientId: w.clientId,
      sourceProgramId: w.templateId,
      sourceVersionId: tmpl.currentVersionId,
    });
    const slotsOf = (versionId: string | null) =>
      withSystem(
        (tx) =>
          tx.programSlot.findMany({
            where: { programVersionId: versionId! },
            orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
          }),
        prisma,
      );
    const [ts, cs] = await Promise.all([
      slotsOf(tmpl.currentVersionId),
      slotsOf(copy.currentVersionId),
    ]);
    expect(cs).toHaveLength(6);
    expect(cs.map((s) => [s.weekIndex, s.dayIndex, s.workoutVersionId])).toEqual(
      ts.map((s) => [s.weekIndex, s.dayIndex, s.workoutVersionId]),
    );
    expect(copy.currentVersionId).not.toBe(tmpl.currentVersionId);
    const cv = await withSystem(
      (tx) => tx.programVersion.findUniqueOrThrow({ where: { id: copy.currentVersionId! } }),
      prisma,
    );
    expect(cv).toMatchObject({ versionNo: 1, daysPerWeek: 3, weekCount: 2 });

    const sessions = await sessionsOf(res.assignmentId);
    expect(sessions.map((s) => ymd(s.scheduledLocalDate))).toEqual([
      '2026-11-04',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
      '2026-11-13',
      '2026-11-16',
    ]);
    expect(sessions.map((s) => [s.slotWeekIndex, s.slotDayIndex])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    // EST (UTC-5) after DST ended on 2026-11-01.
    expect(sessions[0]!.scheduledAt.toISOString()).toBe('2026-11-04T05:00:00.000Z');
    expect(sessions[0]!.dueAt.toISOString()).toBe('2026-11-05T04:59:00.000Z');
    expect(sessions.every((s) => s.state === 'scheduled' && s.workoutVersionId === null)).toBe(
      true,
    );
    expect(sessions.every((s) => s.pauseOffsetDays === 0 && s.clientId === w.clientId)).toBe(true);

    const a = await withSystem(
      (tx) => tx.programAssignment.findUniqueOrThrow({ where: { id: res.assignmentId } }),
      prisma,
    );
    expect(a).toMatchObject({
      status: 'active',
      timezone: NY,
      weekdays: [1, 3, 5],
      programId: res.clientProgramId,
      readinessConfirmedBy: coachId,
    });
    expect(a.readinessConfirmedAt).toBeInstanceOf(Date);
    expect(ymd(a.startLocalDate)).toBe('2026-11-04');

    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: res.assignmentId } }),
      prisma,
    );
    expect(audits.map((x) => x.action)).toEqual(['assignment.created']);
    // D-007: the readiness confirmation is part of the audit trail.
    expect(audits[0]!.metadataJson).toMatchObject({ readinessConfirmed: true });
  });

  it('a replacement without readiness does not claim it in the audit metadata', async () => {
    const w = await world();
    await assign(w);
    const res = await assign(w, { readinessConfirmed: false, confirmReplace: true });
    const audit = await withSystem(
      (tx) =>
        tx.auditEvent.findFirstOrThrow({
          where: { objectId: res.assignmentId, action: 'assignment.created' },
        }),
      prisma,
    );
    expect(audit.metadataJson).not.toHaveProperty('readinessConfirmed');
  });

  it('start date before today in the client zone -> VALIDATION startLocalDate, nothing written', async () => {
    const w = await world();
    // 03:00Z on Nov 4 is still Nov 3 (22:00) in New York: Nov 3 is today there, Nov 2 is the past.
    const now = new Date('2026-11-04T03:00:00Z');
    const err = await assign(w, { startLocalDate: '2026-11-02' }, now).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { startLocalDate: ["Start date can't be in the past."] },
    });
    expect(
      await withSystem(
        (tx) => tx.programAssignment.count({ where: { clientId: w.clientId } }),
        prisma,
      ),
    ).toBe(0);
    expect(await codeOf(assign(w, { startLocalDate: '2026-11-03' }, now))).toBe('ok');
  });

  it('a back-dated replacement is rejected and cancels nothing', async () => {
    const w = await world();
    const first = await assign(w);
    const later = new Date('2026-11-10T15:00:00Z');
    const err = await assign(
      w,
      { startLocalDate: '2026-11-05', readinessConfirmed: false, confirmReplace: true },
      later,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { startLocalDate: [expect.any(String)] },
    });
    const sessions = await sessionsOf(first.assignmentId);
    expect(sessions.every((s) => s.state === 'scheduled')).toBe(true);
  });

  it('first assignment requires readiness', async () => {
    const w = await world();
    const err = await assign(w, { readinessConfirmed: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as DomainError).fieldErrors).toHaveProperty('readinessConfirmed');
    expect(
      await withSystem(
        (tx) => tx.programAssignment.count({ where: { clientId: w.clientId } }),
        prisma,
      ),
    ).toBe(0);
  });

  it('second assignment without confirmReplace -> ACTIVE_ASSIGNMENT_EXISTS', async () => {
    const w = await world();
    await assign(w);
    expect(await codeOf(assign(w, { readinessConfirmed: false }))).toBe('ACTIVE_ASSIGNMENT_EXISTS');
    const active = await withSystem(
      (tx) => tx.programAssignment.count({ where: { clientId: w.clientId, status: 'active' } }),
      prisma,
    );
    expect(active).toBe(1);
  });

  it('concurrent assigns for one client: exactly one wins', async () => {
    const w = await world();
    const results = await Promise.all([codeOf(assign(w)), codeOf(assign(w))]);
    expect(results.sort()).toEqual(['ACTIVE_ASSIGNMENT_EXISTS', 'ok']);
  });

  it('replacement ends old, cancels only unstarted sessions on/after new start', async () => {
    const w = await world();
    const first = await assign(w);
    const old = await sessionsOf(first.assignmentId);
    const at = (d: string) => old.find((s) => ymd(s.scheduledLocalDate) === d)!;
    await withSystem(async (tx) => {
      await tx.workoutSession.updateMany({
        where: { id: at('2026-11-04').id },
        data: { state: 'completed', completedAt: new Date() },
      });
      await tx.workoutSession.updateMany({
        where: { id: at('2026-11-13').id },
        data: { state: 'in_progress', startedAt: new Date() },
      });
    }, prisma);

    const second = await assign(w, {
      startLocalDate: '2026-11-11',
      confirmReplace: true,
      readinessConfirmed: false,
    });
    expect(second.assignmentId).not.toBe(first.assignmentId);

    const oldRow = await withSystem(
      (tx) => tx.programAssignment.findUniqueOrThrow({ where: { id: first.assignmentId } }),
      prisma,
    );
    expect(oldRow.status).toBe('ended');
    expect(oldRow.endedAt).toBeInstanceOf(Date);
    const after = Object.fromEntries(
      (await sessionsOf(first.assignmentId)).map((s) => [ymd(s.scheduledLocalDate), s.state]),
    );
    expect(after).toEqual({
      '2026-11-04': 'completed', // untouched, before start
      '2026-11-06': 'scheduled', // before new start
      '2026-11-09': 'scheduled', // before new start
      '2026-11-11': 'cancelled',
      '2026-11-13': 'in_progress', // started: untouched
      '2026-11-16': 'cancelled',
    });
    const actions = (
      await withSystem(
        (tx) =>
          tx.auditEvent.findMany({
            where: {
              action: { in: ['assignment.created', 'assignment.replaced'] },
              organizationId: w.actor.orgId,
            },
          }),
        prisma,
      )
    ).map((a) => a.action);
    expect(actions.sort()).toEqual([
      'assignment.created',
      'assignment.created',
      'assignment.replaced',
    ]);
    const summary = await run(w.actor, (tx) => getAssignmentSummary(tx, w.actor, w.clientId));
    expect(summary?.assignmentId).toBe(second.assignmentId);
  });

  it('editing the template after assign does not change the client program', async () => {
    const w = await world();
    const res = await assign(w);
    const before = await run(w.actor, (tx) => getProgram(tx, w.actor, res.clientProgramId));
    await run(w.actor, (tx) =>
      commitProgramVersion(tx, w.actor, {
        programId: w.templateId,
        expectedVersionNo: 1,
        weeks: grid(2, 3, 'Edited'),
      }),
    );
    const after = await run(w.actor, (tx) => getProgram(tx, w.actor, res.clientProgramId));
    expect(after).toEqual(before);
    expect(after.weeks[0]!.days[0]!.title).toBe('W1D1');
  });

  it('invited (not active) client -> CONFLICT', async () => {
    const w = await world({ clientStatus: 'invited' });
    expect(await codeOf(assign(w))).toBe('CONFLICT');
  });

  it('template without a committed version -> VALIDATION templateProgramId', async () => {
    const w = await world();
    const { id } = await run(w.actor, (tx) => createProgram(tx, w.actor, { title: 'Empty' }));
    const err = await assign(w, { templateProgramId: id }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as DomainError).fieldErrors).toHaveProperty('templateProgramId');
  });

  it('weekday count mismatch -> VALIDATION weekdays', async () => {
    const w = await world();
    const err = await assign(w, { weekdays: [1, 3] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as DomainError).fieldErrors).toHaveProperty('weekdays');
  });

  it('partial unique index forbids two active assignments (direct insert fails)', async () => {
    const w = await world();
    const res = await assign(w);
    const base = {
      organizationId: w.actor.orgId,
      clientId: w.clientId,
      programId: res.clientProgramId,
      startLocalDate: new Date('2026-12-01'),
      weekdays: [1, 3, 5],
      timezone: NY,
    };
    await expect(
      withSystem((tx) => tx.programAssignment.create({ data: base }), prisma),
    ).rejects.toMatchObject({ code: 'P2002' });
    // An ended one next to the active one is fine.
    await expect(
      withSystem(
        (tx) =>
          tx.programAssignment.create({ data: { ...base, status: 'ended', endedAt: new Date() } }),
        prisma,
      ),
    ).resolves.toBeTruthy();
  });

  it('template from another org -> NOT_FOUND', async () => {
    const w = await world();
    const other = await world();
    expect(await codeOf(assign(w, { templateProgramId: other.templateId }))).toBe('NOT_FOUND');
    expect(await codeOf(assign(w, { clientId: other.clientId }))).toBe('NOT_FOUND');
  });

  it('client role cannot assign', async () => {
    const w = await world();
    const clientActor: ActorContext = { ...w.actor, role: 'client' };
    expect(await codeOf(run(clientActor, (tx) => assignProgram(tx, clientActor, input(w))))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('getAssignmentSummary', () => {
  it('null without assignment; otherwise title, weekdays, count and next session', async () => {
    const w = await world();
    expect(await run(w.actor, (tx) => getAssignmentSummary(tx, w.actor, w.clientId))).toBeNull();
    const res = await assign(w);
    const s = await run(w.actor, (tx) =>
      getAssignmentSummary(tx, w.actor, w.clientId, { now: new Date('2026-11-05T12:00:00Z') }),
    );
    expect(s).toEqual({
      assignmentId: res.assignmentId,
      programId: res.clientProgramId,
      programTitle: 'Template',
      startLocalDate: '2026-11-04',
      weekdays: [1, 3, 5],
      sessionCount: 6,
      nextSession: { localDate: '2026-11-06', title: 'W1D2' },
    });
  });
});

describe('getProgramAssignee', () => {
  it("the client of a copy's active assignment; null for templates and ended copies", async () => {
    const w = await world();
    const res = await assign(w);
    const assignee = await run(w.actor, (tx) =>
      getProgramAssignee(tx, w.actor, res.clientProgramId),
    );
    expect(assignee).toEqual({ clientId: w.clientId, clientName: expect.any(String) });
    expect(await run(w.actor, (tx) => getProgramAssignee(tx, w.actor, w.templateId))).toBeNull();
    await withSystem(
      (tx) =>
        tx.programAssignment.update({
          where: { id: res.assignmentId },
          data: { status: 'ended', endedAt: new Date() },
        }),
      prisma,
    );
    expect(
      await run(w.actor, (tx) => getProgramAssignee(tx, w.actor, res.clientProgramId)),
    ).toBeNull();
    expect(await run(w.actor, (tx) => getProgramAssignee(tx, w.actor, 'nope'))).toBeNull();
  });
});

describe('getAssignmentSummary nextSession', () => {
  it('shows an overdue in-progress session before the next scheduled one', async () => {
    const w = await world();
    const { assignmentId } = await assign(w);
    const [first] = await sessionsOf(assignmentId);
    await withSystem(
      (tx) =>
        tx.workoutSession.update({
          where: { id: first!.id },
          data: { state: 'in_progress', startedAt: NOW },
        }),
      prisma,
    );
    // Two days after the first session's due time.
    const later = new Date('2026-11-07T15:00:00Z');
    const summary = await run(w.actor, (tx) =>
      getAssignmentSummary(tx, w.actor, w.clientId, { now: later }),
    );
    expect(summary?.nextSession).toEqual({ localDate: '2026-11-04', title: 'W1D1' });
  });
});
