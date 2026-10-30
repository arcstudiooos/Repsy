import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant, type SystemTx } from './tenant';
import type { PrismaClient } from './generated/client';

/**
 * D-008 schema fix: parent and child rows must share an organization. Composite (child_fk, organization_id) FKs make
 * the database refuse a child that points at another tenant's parent, even from system scope (RLS bypassed).
 */

const BENCH = 'e0000000-0000-4000-8000-000000000001';

let prisma: PrismaClient;
let schema: string;
let drop: () => Promise<void>;

interface Tenant {
  orgId: string;
  userId: string;
  clientId: string;
  programId: string;
  programVersionId: string;
  workoutVersionId: string;
  assignmentId: string;
  sessionId: string;
  workoutVersionExerciseId: string;
  setLogId: string;
  checkinTemplateId: string;
}
let a: Tenant;
let b: Tenant;

async function seedTenant(tx: SystemTx, label: string): Promise<Tenant> {
  const user = await tx.user.create({ data: { email: `${label}@example.test`, name: label } });
  const org = await tx.organization.create({
    data: { name: label, timezone: 'UTC', ownerUserId: user.id },
  });
  const client = await tx.client.create({
    data: {
      organizationId: org.id,
      coachUserId: user.id,
      name: 'C',
      email: `c-${label}@example.test`,
      status: 'active',
      timezone: 'UTC',
    },
  });
  const program = await tx.program.create({
    data: { organizationId: org.id, title: 'P', createdBy: user.id },
  });
  const wv = await tx.workoutVersion.create({
    data: { organizationId: org.id, title: 'W', contentHash: label },
  });
  const pv = await tx.programVersion.create({
    data: {
      organizationId: org.id,
      programId: program.id,
      versionNo: 1,
      committedBy: user.id,
      daysPerWeek: 1,
      weekCount: 1,
    },
  });
  const assignment = await tx.programAssignment.create({
    data: {
      organizationId: org.id,
      clientId: client.id,
      programId: program.id,
      startLocalDate: new Date('2026-11-04'),
      weekdays: [1],
      timezone: 'UTC',
    },
  });
  const wve = await tx.workoutVersionExercise.create({
    data: {
      organizationId: org.id,
      workoutVersionId: wv.id,
      exerciseId: BENCH,
      position: 0,
      targetJson: [{ reps: 5 }],
    },
  });
  const ws = await tx.workoutSession.create({
    data: {
      organizationId: org.id,
      assignmentId: assignment.id,
      clientId: client.id,
      slotWeekIndex: 9,
      slotDayIndex: 0,
      scheduledLocalDate: new Date('2026-11-04'),
      scheduledAt: new Date('2026-11-04T00:00:00Z'),
      dueAt: new Date('2026-11-04T23:59:00Z'),
      workoutVersionId: wv.id,
      state: 'in_progress',
    },
  });
  const log = await tx.setLog.create({
    data: {
      organizationId: org.id,
      sessionId: ws.id,
      workoutVersionExerciseId: wve.id,
      setIndex: 17,
      reps: 5,
      clientUpdatedAt: new Date(),
      clientMutationId: crypto.randomUUID(),
      loggedByUserId: user.id,
    },
  });
  const template = await tx.checkinTemplate.create({
    data: { organizationId: org.id, title: 'T', questionsJson: [] },
  });
  return {
    orgId: org.id,
    checkinTemplateId: template.id,
    setLogId: log.id,
    userId: user.id,
    sessionId: ws.id,
    workoutVersionExerciseId: wve.id,
    clientId: client.id,
    programId: program.id,
    programVersionId: pv.id,
    workoutVersionId: wv.id,
    assignmentId: assignment.id,
  };
}

const checkinRow = (own: Tenant, clientId: string, templateId: string) => ({
  organizationId: own.orgId,
  clientId,
  templateId,
  periodLocalDate: new Date(`20${Math.floor(Math.random() * 70) + 30}-01-05`),
  questionsJson: [],
  issuedAt: new Date('2026-11-04T06:00:00Z'),
  dueAt: new Date('2026-11-04T23:59:00Z'),
});

const session = (own: Tenant, assignmentId: string, clientId: string, day: number) => ({
  organizationId: own.orgId,
  assignmentId,
  clientId,
  slotWeekIndex: 0,
  slotDayIndex: day,
  scheduledLocalDate: new Date('2026-11-04'),
  scheduledAt: new Date('2026-11-04T00:00:00Z'),
  dueAt: new Date('2026-11-04T23:59:00Z'),
});

const assignmentRow = (own: Tenant, clientId: string, programId: string) => ({
  organizationId: own.orgId,
  clientId,
  programId,
  startLocalDate: new Date('2026-11-04'),
  weekdays: [1],
  timezone: 'UTC',
  status: 'ended' as const,
});

const setLog = (own: Tenant, sessionId: string, wveId: string, setIndex: number) => ({
  organizationId: own.orgId,
  sessionId,
  workoutVersionExerciseId: wveId,
  setIndex,
  reps: 5,
  clientUpdatedAt: new Date(),
  clientMutationId: crypto.randomUUID(),
  loggedByUserId: own.userId,
});

const revision = (own: Tenant, setLogId: string, sessionId: string) => ({
  organizationId: own.orgId,
  setLogId,
  sessionId,
  beforeJson: { reps: 5, weightKg: null, rpe: null, durationSeconds: null, distanceM: null },
  afterJson: { reps: 6, weightKg: null, rpe: null, durationSeconds: null, distanceM: null },
  reason: 'Miscounted',
  revisedBy: own.userId,
  revisedByRole: 'coach' as const,
});

type Insert = (tx: SystemTx, own: Tenant, parent: Tenant) => Promise<unknown>;

/** Each case inserts one child row in org `own` whose parent fields come from `parent`. */
const CASES: [string, Insert][] = [
  [
    'workout_sessions -> program_assignments',
    (tx, own, parent) =>
      tx.workoutSession.create({ data: session(own, parent.assignmentId, own.clientId, 0) }),
  ],
  [
    'workout_sessions -> clients',
    (tx, own, parent) =>
      tx.workoutSession.create({ data: session(own, own.assignmentId, parent.clientId, 1) }),
  ],
  [
    'workout_sessions -> workout_versions (locked version)',
    (tx, own, parent) =>
      tx.workoutSession.create({
        data: {
          ...session(own, own.assignmentId, own.clientId, 2),
          workoutVersionId: parent.workoutVersionId,
        },
      }),
  ],
  [
    'programs.current_version_id -> program_versions',
    (tx, own, parent) =>
      tx.program.create({
        data: {
          organizationId: own.orgId,
          title: 'Current',
          createdBy: own.userId,
          currentVersionId: parent.programVersionId,
        },
      }),
  ],
  [
    'programs.source_program_id -> programs',
    (tx, own, parent) =>
      tx.program.create({
        data: {
          organizationId: own.orgId,
          title: 'Copy',
          kind: 'client',
          clientId: own.clientId,
          sourceProgramId: parent.programId,
          createdBy: own.userId,
        },
      }),
  ],
  [
    'programs.source_version_id -> program_versions',
    (tx, own, parent) =>
      tx.program.create({
        data: {
          organizationId: own.orgId,
          title: 'Copy',
          kind: 'client',
          clientId: own.clientId,
          sourceVersionId: parent.programVersionId,
          createdBy: own.userId,
        },
      }),
  ],
  [
    'set_logs -> workout_sessions',
    (tx, own, parent) =>
      tx.setLog.create({ data: setLog(own, parent.sessionId, own.workoutVersionExerciseId, 0) }),
  ],
  [
    'set_logs -> workout_version_exercises',
    (tx, own, parent) =>
      tx.setLog.create({ data: setLog(own, own.sessionId, parent.workoutVersionExerciseId, 1) }),
  ],
  [
    'set_log_revisions -> set_logs',
    (tx, own, parent) =>
      tx.setLogRevision.create({ data: revision(own, parent.setLogId, own.sessionId) }),
  ],
  [
    'set_log_revisions -> workout_sessions',
    (tx, own, parent) =>
      tx.setLogRevision.create({ data: revision(own, own.setLogId, parent.sessionId) }),
  ],
  [
    'program_assignments -> clients',
    (tx, own, parent) =>
      tx.programAssignment.create({ data: assignmentRow(own, parent.clientId, own.programId) }),
  ],
  [
    'program_assignments -> programs',
    (tx, own, parent) =>
      tx.programAssignment.create({ data: assignmentRow(own, own.clientId, parent.programId) }),
  ],
  [
    'client_invites -> clients',
    (tx, own, parent) =>
      tx.clientInvite.create({
        data: {
          organizationId: own.orgId,
          clientId: parent.clientId,
          tokenHash: `h-${crypto.randomUUID()}`,
          expiresAt: new Date('2099-01-01'),
          createdBy: own.userId,
        },
      }),
  ],
  [
    'checkins -> clients',
    (tx, own, parent) =>
      tx.checkin.create({ data: checkinRow(own, parent.clientId, own.checkinTemplateId) }),
  ],
  [
    'checkins -> checkin_templates',
    (tx, own, parent) =>
      tx.checkin.create({ data: checkinRow(own, own.clientId, parent.checkinTemplateId) }),
  ],
  [
    'clients -> checkin_templates',
    (tx, own, parent) =>
      tx.client.create({
        data: {
          organizationId: own.orgId,
          coachUserId: own.userId,
          name: 'C2',
          email: `c2-${crypto.randomUUID()}@example.test`,
          timezone: 'UTC',
          checkinWeekday: 1,
          checkinTemplateId: parent.checkinTemplateId,
        },
      }),
  ],
  [
    'client_pauses -> clients',
    (tx, own, parent) =>
      tx.clientPause.create({
        data: {
          organizationId: own.orgId,
          clientId: parent.clientId,
          startLocalDate: new Date('2099-01-01'),
          resumeLocalDate: new Date('2099-01-08'),
          createdBy: own.userId,
        },
      }),
  ],
  [
    'programs -> clients',
    (tx, own, parent) =>
      tx.program.create({
        data: {
          organizationId: own.orgId,
          title: 'Copy',
          kind: 'client',
          clientId: parent.clientId,
          createdBy: own.userId,
        },
      }),
  ],
  [
    'program_drafts -> programs',
    (tx, own, parent) =>
      tx.programDraft.create({
        data: {
          organizationId: own.orgId,
          programId: parent.programId,
          draftJson: { weeks: [] },
          updatedBy: own.userId,
        },
      }),
  ],
  [
    'program_versions -> programs',
    (tx, own, parent) =>
      tx.programVersion.create({
        data: {
          organizationId: own.orgId,
          programId: parent.programId,
          versionNo: Math.floor(Math.random() * 1_000_000) + 2,
          committedBy: own.userId,
          daysPerWeek: 1,
          weekCount: 1,
        },
      }),
  ],
  [
    'program_slots -> program_versions',
    (tx, own, parent) =>
      tx.programSlot.create({
        data: {
          organizationId: own.orgId,
          programVersionId: parent.programVersionId,
          weekIndex: 0,
          dayIndex: 5,
          workoutVersionId: own.workoutVersionId,
        },
      }),
  ],
  [
    'program_slots -> workout_versions',
    (tx, own, parent) =>
      tx.programSlot.create({
        data: {
          organizationId: own.orgId,
          programVersionId: own.programVersionId,
          weekIndex: 0,
          dayIndex: 6,
          workoutVersionId: parent.workoutVersionId,
        },
      }),
  ],
  [
    'workout_version_exercises -> workout_versions',
    (tx, own, parent) =>
      tx.workoutVersionExercise.create({
        data: {
          organizationId: own.orgId,
          workoutVersionId: parent.workoutVersionId,
          exerciseId: BENCH,
          position: 9,
          targetJson: [{ reps: 5 }],
        },
      }),
  ],
];

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => {
      const err = e as { code?: string; message?: string };
      if (err.code === 'P2003' || /foreign key/i.test(err.message ?? '')) return 'FK';
      return `other: ${err.code ?? ''} ${err.message ?? String(e)}`;
    },
  );

beforeAll(async () => {
  ({ prisma, schema, drop } = await createTestDb());
  ({ a, b } = await withSystem(
    async (tx) => ({ a: await seedTenant(tx, 'a'), b: await seedTenant(tx, 'b') }),
    prisma,
  ));
});
afterAll(async () => {
  await drop();
});

describe('cross-tenant parent links are refused by the database', () => {
  it.each(CASES)(
    '%s: a child pointing at another org parent is a FK violation',
    async (_n, insert) => {
      expect(await outcome(withSystem((tx) => insert(tx, a, b), prisma))).toBe('FK');
    },
  );

  it.each(CASES)('%s: the same-org link is accepted (control)', async (_n, insert) => {
    expect(await outcome(withSystem((tx) => insert(tx, a, a), prisma))).toBe('ok');
  });

  // Production writes these two links with UPDATE (session start lock, program commit), not INSERT.
  it('updating a session lock or a program current version to another org is a FK violation', async () => {
    const own = await withSystem(
      async (tx) => ({
        session: await tx.workoutSession.create({
          data: session(a, a.assignmentId, a.clientId, 4),
        }),
        program: await tx.program.create({
          data: { organizationId: a.orgId, title: 'U', createdBy: a.userId },
        }),
      }),
      prisma,
    );
    const lock = (wv: string) =>
      withSystem(
        (tx) =>
          tx.workoutSession.updateMany({
            where: { id: own.session.id },
            data: { workoutVersionId: wv },
          }),
        prisma,
      );
    const current = (pv: string) =>
      withSystem(
        (tx) =>
          tx.program.updateMany({ where: { id: own.program.id }, data: { currentVersionId: pv } }),
        prisma,
      );
    expect(await outcome(lock(b.workoutVersionId))).toBe('FK');
    expect(await outcome(current(b.programVersionId))).toBe('FK');
    expect(await outcome(lock(a.workoutVersionId))).toBe('ok');
  });

  it('a client copy with no client (MATCH SIMPLE) is still allowed', async () => {
    const created = withSystem(
      (tx) =>
        tx.program.create({
          data: { organizationId: b.orgId, title: 'T', kind: 'client', createdBy: b.userId },
        }),
      prisma,
    );
    expect(await outcome(created)).toBe('ok');
  });
});

describe('session sweep index', () => {
  it('workout_sessions has an (organization_id, state, due_at) index', async () => {
    const rows = await withSystem(
      (tx) =>
        tx.$queryRaw<{ indexdef: string }[]>`
          SELECT indexdef FROM pg_indexes
          WHERE schemaname = ${schema} AND tablename = 'workout_sessions'`,
      prisma,
    );
    expect(rows.map((r) => r.indexdef)).toContainEqual(
      expect.stringMatching(/\(organization_id, state, due_at\)$/),
    );
  });
});

describe('set_logs constraints', () => {
  it('range CHECKs reject out-of-range values even from system scope', async () => {
    const bad = [{ reps: 1001 }, { rpe: 11 }, { weightKg: 2000.5 }, { setIndex: 20 }];
    for (const [i, over] of bad.entries()) {
      const res = await outcome(
        withSystem(
          (tx) =>
            tx.setLog.create({
              data: { ...setLog(b, b.sessionId, b.workoutVersionExerciseId, 10 + i), ...over },
            }),
          prisma,
        ),
      );
      expect(res).toMatch(/check|23514/i);
    }
  });

  it('one row per (session, exercise, set index)', async () => {
    const row = setLog(b, b.sessionId, b.workoutVersionExerciseId, 18);
    expect(await outcome(withSystem((tx) => tx.setLog.create({ data: row }), prisma))).toBe('ok');
    expect(
      await outcome(
        withSystem(
          (tx) => tx.setLog.create({ data: { ...row, clientMutationId: crypto.randomUUID() } }),
          prisma,
        ),
      ),
    ).toMatch(/P2002/);
  });
});

describe('set_log_revisions (S3-4)', () => {
  it('are append-only: UPDATE, DELETE and TRUNCATE fail even from system scope', async () => {
    const row = await withSystem(
      (tx) => tx.setLogRevision.create({ data: revision(b, b.setLogId, b.sessionId) }),
      prisma,
    );
    await expect(
      withSystem(
        (tx) =>
          tx.setLogRevision.updateMany({ where: { id: row.id }, data: { reason: 'Changed' } }),
        prisma,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withSystem(
        (tx) => tx.$executeRawUnsafe(`UPDATE "${schema}"."set_log_revisions" SET reason = 'x'`),
        prisma,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withSystem((tx) => tx.setLogRevision.deleteMany({ where: { id: row.id } }), prisma),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`TRUNCATE "${schema}"."set_log_revisions" CASCADE`),
    ).rejects.toThrow(/append-only/);
    expect(
      await withSystem((tx) => tx.setLogRevision.count({ where: { id: row.id } }), prisma),
    ).toBe(1);
  });

  it('a reason over 500 characters is refused by the database', async () => {
    const res = await outcome(
      withSystem(
        (tx) =>
          tx.setLogRevision.create({
            data: { ...revision(b, b.setLogId, b.sessionId), reason: 'x'.repeat(501) },
          }),
        prisma,
      ),
    );
    expect(res).toMatch(/check|23514/i);
  });

  it("a tenant transaction sees only its own organization's revisions", async () => {
    await withSystem(
      (tx) => tx.setLogRevision.create({ data: revision(a, a.setLogId, a.sessionId) }),
      prisma,
    );
    const seen = await withTenant(
      a.orgId,
      (tx) => tx.setLogRevision.findMany({ select: { organizationId: true } }),
      prisma,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.organizationId))).toEqual(new Set([a.orgId]));
    await expect(
      withTenant(
        a.orgId,
        (tx) => tx.setLogRevision.create({ data: revision(b, b.setLogId, b.sessionId) }),
        prisma,
      ),
    ).rejects.toThrow();
  });
});

describe('session version lock (D-002 #6)', () => {
  it('a locked workout version can not be replaced or cleared, even from system scope', async () => {
    const other = await withSystem(
      (tx) =>
        tx.workoutVersion.create({
          data: { organizationId: b.orgId, title: 'Other', contentHash: 'other' },
        }),
      prisma,
    );
    const set = (workoutVersionId: string | null) =>
      outcome(
        withSystem(
          (tx) =>
            tx.workoutSession.updateMany({
              where: { id: b.sessionId },
              data: { workoutVersionId },
            }),
          prisma,
        ),
      );
    expect(await set(other.id)).toMatch(/locked/);
    expect(await set(null)).toMatch(/locked/);
    // Rewriting the same value and touching other columns stay allowed.
    expect(await set(b.workoutVersionId)).toBe('ok');
    expect(
      await outcome(
        withSystem(
          (tx) =>
            tx.workoutSession.updateMany({
              where: { id: b.sessionId },
              data: { state: 'completed' },
            }),
          prisma,
        ),
      ),
    ).toBe('ok');
  });
});
