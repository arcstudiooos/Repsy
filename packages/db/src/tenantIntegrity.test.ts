import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testing/createTestDb';
import { withSystem, type SystemTx } from './tenant';
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
  return {
    orgId: org.id,
    userId: user.id,
    clientId: client.id,
    programId: program.id,
    programVersionId: pv.id,
    workoutVersionId: wv.id,
    assignmentId: assignment.id,
  };
}

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
