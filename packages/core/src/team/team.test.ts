import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { can } from '../authz/policies';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  acceptTeamInvite,
  changeTeamRole,
  inviteTeammate,
  listTeam,
  lookupTeamInvite,
  removeTeammate,
} from './team';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const newUser = (email: string, emailVerified = true) =>
  withSystem(
    (tx) => tx.user.create({ data: { email, name: email.split('@')[0]!, emailVerified } }),
    prisma,
  );
/** The invite email's token (only the outbox payload holds it). */
const tokenFor = async (email: string) => {
  const row = await withSystem(
    (tx) =>
      tx.outboxEmail.findFirstOrThrow({
        where: { kind: 'team_invite', toEmail: email },
        orderBy: { createdAt: 'desc' },
      }),
    prisma,
  );
  return (row.payloadJson as { token: string }).token;
};

describe('team roles and invites (PRD A10)', () => {
  it('the owner invites a coach, who joins with the invited account', async () => {
    const org = await newOrg(prisma);
    const email = `coach-${Date.now()}@example.test`;
    await runAs(prisma, org.coach, (tx) => inviteTeammate(tx, org.coach, { email, role: 'coach' }));
    const token = await tokenFor(email);
    expect(await lookupTeamInvite(prisma, token)).toMatchObject({ role: 'coach', state: 'open' });

    const other = await newUser(`other-${Date.now()}@example.test`);
    await expect(
      acceptTeamInvite(prisma, token, { id: other.id, email: other.email, emailVerified: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const joiner = await newUser(email);
    expect(
      await acceptTeamInvite(prisma, token, { id: joiner.id, email, emailVerified: true }),
    ).toEqual({ orgId: org.orgId });
    expect((await lookupTeamInvite(prisma, token))?.state).toBe('used');
    const team = await runAs(prisma, org.coach, (tx) => listTeam(tx, org.coach));
    expect(team.members.map((m) => m.role)).toEqual(['owner', 'coach']);
    expect(team.invites).toEqual([]);
  });

  it('who may grant what: only the owner makes admins; coaches invite no one', async () => {
    const org = await newOrg(prisma);
    const adminUser = await newUser(`admin-${Date.now()}@example.test`);
    const adminMembership = await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: adminUser.id, organizationId: org.orgId, role: 'admin' },
        }),
      prisma,
    );
    const admin: ActorContext = {
      userId: adminUser.id,
      orgId: org.orgId,
      role: 'admin',
      isPlatformAdmin: false,
    };
    const coach: ActorContext = { ...admin, role: 'coach' };
    await expect(
      runAs(prisma, admin, (tx) =>
        inviteTeammate(tx, admin, { email: 'x@example.test', role: 'admin' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runAs(prisma, admin, (tx) =>
      inviteTeammate(tx, admin, { email: 'y@example.test', role: 'assistant' }),
    );
    await expect(
      runAs(prisma, coach, (tx) =>
        inviteTeammate(tx, coach, { email: 'z@example.test', role: 'coach' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The owner demotes the admin to assistant.
    await runAs(prisma, org.coach, (tx) =>
      changeTeamRole(tx, org.coach, adminMembership.id, 'assistant'),
    );
    const team = await runAs(prisma, org.coach, (tx) => listTeam(tx, org.coach));
    expect(team.members.find((m) => m.userId === adminUser.id)?.role).toBe('assistant');
  });

  it('assistants message and review but do not edit programs or clients', () => {
    const assistant: ActorContext = {
      userId: 'u',
      orgId: 'o',
      role: 'assistant',
      isPlatformAdmin: false,
    };
    expect(can(assistant, 'message:send')).toBe(true);
    expect(can(assistant, 'review:update')).toBe(true);
    expect(can(assistant, 'program:write')).toBe(false);
    expect(can(assistant, 'client:update')).toBe(false);
    expect(can({ ...assistant, role: 'admin' }, 'settings:org:update')).toBe(true);
    expect(can({ ...assistant, role: 'admin' }, 'export:org')).toBe(false);
  });

  it('a coach with clients is moved off them before removal', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const coachUser = await newUser(`c-${Date.now()}@example.test`);
    const m = await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: coachUser.id, organizationId: org.orgId, role: 'coach' },
        }),
      prisma,
    );
    await withSystem(
      (tx) => tx.client.update({ where: { id: w.clientId }, data: { coachUserId: coachUser.id } }),
      prisma,
    );
    await expect(
      runAs(prisma, org.coach, (tx) => removeTeammate(tx, org.coach, m.id)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await withSystem(
      (tx) =>
        tx.client.update({ where: { id: w.clientId }, data: { coachUserId: org.coach.userId } }),
      prisma,
    );
    await runAs(prisma, org.coach, (tx) => removeTeammate(tx, org.coach, m.id));
    const team = await runAs(prisma, org.coach, (tx) => listTeam(tx, org.coach));
    expect(team.members.map((x) => x.userId)).toEqual([org.coach.userId]);
  });
});
