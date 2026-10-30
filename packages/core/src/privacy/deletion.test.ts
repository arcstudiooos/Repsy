import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import {
  createPilotCode,
  decideDeletion,
  grantSupportAccess,
  listDeletionRequests,
  lookupAccount,
  readClientForSupport,
  revokeSupportAccess,
} from '../admin/admin';
import { DomainError } from '../errors';
import { createNote } from '../history/notes';
import { reviseSetLogs } from '../logging/revise';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { getMyThread, sendMessage } from '../messages/messages';
import { completeSession, startSession } from '../sessions/lifecycle';
import {
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { eraseClientData, requestDeletion } from './deletion';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let adminId: string;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  adminId = await withSystem(
    async (tx) =>
      (
        await tx.user.create({
          data: { email: 'admin@example.test', name: 'Admin', isPlatformAdmin: true },
        })
      ).id,
    prisma,
  );
});
afterAll(async () => {
  await drop();
});

const admin = () => ({ userId: adminId, isPlatformAdmin: true });
const sys = <T>(fn: Parameters<typeof withSystem<T>>[0]) => withSystem(fn, prisma);
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

/** A client with a finished, corrected workout, a message, a note and a pause-free history. */
async function busyClient(): Promise<ClientWorld> {
  const w = await newClientWorld(prisma, await newOrg(prisma));
  const [s] = await sessionsOf(prisma, w.assignmentId);
  const detail = await runAs(prisma, w.client, (tx) =>
    startSession(tx, w.client, s!.id, { now: NOW }),
  );
  const ex = detail.workout.exercises[0]!;
  const item = (reps: number, at: Date) => ({
    workoutVersionExerciseId: ex.id,
    setIndex: 0,
    reps,
    weightKg: 50,
    clientUpdatedAt: at.toISOString(),
    clientMutationId: crypto.randomUUID(),
  });
  await runAs(prisma, w.client, (tx) =>
    upsertSetLogs(tx, w.client, s!.id, [item(5, NOW)], { now: NOW }),
  );
  await runAs(prisma, w.client, (tx) =>
    completeSession(tx, w.client, s!.id, { idempotencyKey: crypto.randomUUID() }, { now: NOW }),
  );
  const later = new Date(NOW.getTime() + 60_000);
  await runAs(prisma, w.coach, (tx) =>
    reviseSetLogs(tx, w.coach, s!.id, { items: [item(6, later)], reason: 'Video' }, { now: later }),
  );
  const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
  await runAs(prisma, w.client, (tx) => sendMessage(tx, w.client, thread.id, { body: 'Hello' }));
  await runAs(prisma, w.coach, (tx) => createNote(tx, w.coach, w.clientId, { body: 'Note' }));
  return w;
}

const counts = (w: ClientWorld) =>
  sys(async (tx) => ({
    sessions: await tx.workoutSession.count({ where: { clientId: w.clientId } }),
    setLogs: await tx.setLog.count({ where: { session: { is: { clientId: w.clientId } } } }),
    revisions: await tx.setLogRevision.count({
      where: { session: { is: { clientId: w.clientId } } },
    }),
    messages: await tx.message.count({ where: { thread: { is: { clientId: w.clientId } } } }),
    notes: await tx.internalNote.count({ where: { clientId: w.clientId } }),
    assignments: await tx.programAssignment.count({ where: { clientId: w.clientId } }),
  }));

async function verifiedRequest(w: ClientWorld): Promise<string> {
  const r = await runAs(prisma, w.client, (tx) => requestDeletion(tx, w.client));
  await sys((tx) => decideDeletion(tx, admin(), r.id, { action: 'verify' }));
  return r.id;
}

describe('deletion (S5-3)', () => {
  it('erases the client within the organization, anonymizes the account; rerun is a no-op', async () => {
    const w = await busyClient();
    expect(await counts(w)).toMatchObject({
      sessions: 3,
      setLogs: 1,
      revisions: 1,
      messages: 1,
      notes: 1,
    });
    const id = await verifiedRequest(w);
    const first = await sys((tx) => eraseClientData(tx, id, NOW));
    expect(first.status).toBe('done');
    expect(await counts(w)).toEqual({
      sessions: 0,
      setLogs: 0,
      revisions: 0,
      messages: 0,
      notes: 0,
      assignments: 0,
    });
    const after = await sys(async (tx) => ({
      client: await tx.client.findUniqueOrThrow({ where: { id: w.clientId } }),
      user: await tx.user.findUniqueOrThrow({ where: { id: w.userId } }),
      accounts: await tx.account.count({ where: { userId: w.userId } }),
      memberships: await tx.membership.count({ where: { userId: w.userId } }),
      audits: await tx.auditEvent.findMany({ where: { objectId: id } }),
    }));
    expect(after.client).toMatchObject({
      name: 'Deleted client',
      status: 'archived',
      userId: null,
      goals: null,
    });
    expect(after.user).toMatchObject({ name: 'Deleted user', emailVerified: false });
    expect(after.user.email).toMatch(/@deleted\.invalid$/);
    expect(after).toMatchObject({ accounts: 0, memberships: 0 });
    expect(after.audits.map((a) => a.action)).toEqual([
      'deletion.requested',
      'deletion.verified',
      'deletion.completed',
    ]);
    // Rerun: nothing happens.
    expect((await sys((tx) => eraseClientData(tx, id, NOW))).status).toBe('skipped');
  });

  it('a dual-role user deleted as a client of org B keeps their org A ownership', async () => {
    const w = await busyClient();
    const orgA = await sys(async (tx) => {
      const org = await tx.organization.create({
        data: { name: 'Mine', timezone: 'UTC', ownerUserId: w.userId },
      });
      await tx.membership.create({
        data: { userId: w.userId, organizationId: org.id, role: 'owner' },
      });
      await tx.program.create({
        data: { organizationId: org.id, title: 'My template', createdBy: w.userId },
      });
      return org.id;
    });
    const email = (await sys((tx) => tx.user.findUniqueOrThrow({ where: { id: w.userId } }))).email;
    const id = await verifiedRequest(w);
    await sys((tx) => eraseClientData(tx, id, NOW));
    const kept = await sys(async (tx) => ({
      user: await tx.user.findUniqueOrThrow({ where: { id: w.userId } }),
      memberships: await tx.membership.findMany({ where: { userId: w.userId } }),
      programs: await tx.program.count({ where: { organizationId: orgA } }),
      accounts: await tx.account.count({ where: { userId: w.userId } }),
    }));
    expect(kept.user.email).toBe(email);
    expect(kept.memberships.map((m) => [m.organizationId, m.role])).toEqual([[orgA, 'owner']]);
    expect(kept.programs).toBe(1);
  });

  it('legal hold blocks the run; unverified requests never run; one open request per client', async () => {
    const w = await busyClient();
    const a = await runAs(prisma, w.client, (tx) => requestDeletion(tx, w.client));
    const b = await runAs(prisma, w.coach, (tx) =>
      requestDeletion(tx, w.coach, { clientId: w.clientId }),
    );
    expect(b.id).toBe(a.id);
    expect((await sys((tx) => eraseClientData(tx, a.id, NOW))).status).toBe('skipped');
    await sys((tx) => decideDeletion(tx, admin(), a.id, { action: 'hold', on: true }));
    await sys((tx) => decideDeletion(tx, admin(), a.id, { action: 'verify' }));
    expect((await sys((tx) => eraseClientData(tx, a.id, NOW))).status).toBe('held');
    expect((await counts(w)).sessions).toBe(3);
    const owner = await sys((tx) => tx.deletionRequest.findUniqueOrThrow({ where: { id: a.id } }));
    expect(owner.status).toBe('verified');
    const emails = await sys((tx) =>
      tx.outboxEmail.count({ where: { kind: 'deletion_requested', organizationId: w.orgId } }),
    );
    expect(emails).toBe(1);
  });

  it('set_log_revisions stay append-only outside the deletion job', async () => {
    const w = await busyClient();
    await expect(
      sys((tx) =>
        tx.setLogRevision.deleteMany({ where: { session: { is: { clientId: w.clientId } } } }),
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe('admin console (S5-3)', () => {
  it('non-admins get NOT_FOUND everywhere', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const notAdmin = { userId: w.coach.userId, isPlatformAdmin: false };
    expect(await codeOf(sys((tx) => listDeletionRequests(tx, notAdmin)))).toBe('NOT_FOUND');
    expect(await codeOf(sys((tx) => createPilotCode(tx, notAdmin)))).toBe('NOT_FOUND');
    expect(await codeOf(sys((tx) => readClientForSupport(tx, notAdmin, w.clientId)))).toBe(
      'NOT_FOUND',
    );
  });

  it('support reads need an active grant; grants are audited and expire', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    expect(await codeOf(sys((tx) => readClientForSupport(tx, admin(), w.clientId, NOW)))).toBe(
      'FORBIDDEN',
    );
    expect(
      await codeOf(
        sys((tx) => grantSupportAccess(tx, admin(), { clientId: w.clientId, reason: '' }, NOW)),
      ),
    ).toBe('VALIDATION');
    const g = await sys((tx) =>
      grantSupportAccess(tx, admin(), { clientId: w.clientId, reason: 'Ticket 42' }, NOW),
    );
    const view = await sys((tx) => readClientForSupport(tx, admin(), w.clientId, NOW));
    expect(view.sessions.scheduled).toBe(3);
    const later = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(await codeOf(sys((tx) => readClientForSupport(tx, admin(), w.clientId, later)))).toBe(
      'FORBIDDEN',
    );
    const g2 = await sys((tx) =>
      grantSupportAccess(tx, admin(), { clientId: w.clientId, reason: 'Again' }, NOW),
    );
    await sys((tx) => revokeSupportAccess(tx, admin(), g.id, NOW));
    await sys((tx) => revokeSupportAccess(tx, admin(), g2.id, NOW));
    expect(await codeOf(sys((tx) => readClientForSupport(tx, admin(), w.clientId, NOW)))).toBe(
      'FORBIDDEN',
    );
    const audits = await sys((tx) =>
      tx.auditEvent.findMany({
        where: { organizationId: w.orgId, action: { startsWith: 'support.' } },
      }),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      'support.client_read',
      'support.granted',
      'support.granted',
      'support.revoked',
      'support.revoked',
    ]);
  });

  it('pilot codes are shown once; account lookup lists memberships', async () => {
    const created = await sys((tx) => createPilotCode(tx, admin(), { days: 7 }, NOW));
    expect(created.code).toMatch(/\w/);
    const stored = await sys((tx) => tx.pilotCode.findUniqueOrThrow({ where: { id: created.id } }));
    expect(stored.codeHash).not.toContain(created.code);
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const email = (await sys((tx) => tx.user.findUniqueOrThrow({ where: { id: w.userId } }))).email;
    const account = await sys((tx) => lookupAccount(tx, admin(), email.toUpperCase()));
    expect(account?.memberships).toMatchObject([{ role: 'client', clientId: w.clientId }]);
  });
});
