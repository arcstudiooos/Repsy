import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { signupCoach } from './signupCoach';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let adminId: string;
let userId: string;

const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const day = 86_400_000;

async function seedCode(code: string, patch: { usedBy?: string; expiresAt?: Date } = {}) {
  await withSystem(
    (tx) =>
      tx.pilotCode.create({
        data: {
          codeHash: hash(code),
          createdBy: adminId,
          expiresAt: patch.expiresAt ?? new Date(Date.now() + day),
          ...(patch.usedBy ? { usedBy: patch.usedBy, usedAt: new Date() } : {}),
        },
      }),
    prisma,
  );
}

const input = (pilotCode: string) => ({
  userId,
  pilotCode,
  orgName: 'Iron Works',
  timezone: 'Europe/London',
});
const signup = (pilotCode: string) => withSystem((tx) => signupCoach(tx, input(pilotCode)), prisma);

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  await withSystem(async (tx) => {
    adminId = (await tx.user.create({ data: { email: 'admin@example.test', name: 'A' } })).id;
    userId = (await tx.user.create({ data: { email: 'coach@example.test', name: 'C' } })).id;
  }, prisma);
});

afterAll(async () => {
  await drop();
});

describe('signupCoach', () => {
  it('rejects unknown or used pilot code', async () => {
    await seedCode('USED-CODE', { usedBy: adminId });
    await seedCode('EXPIRED-CODE', { expiresAt: new Date(Date.now() - day) });
    for (const code of ['NOPE', 'USED-CODE', 'EXPIRED-CODE']) {
      const error = await signup(code).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('PILOT_CODE_INVALID');
    }
    expect(await withSystem((tx) => tx.organization.count(), prisma)).toBe(0);
  });

  it('creates org, owner membership and marks code used', async () => {
    await seedCode('GOOD-CODE');
    const { orgId } = await signup('GOOD-CODE');

    await withSystem(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org).toMatchObject({
        name: 'Iron Works',
        timezone: 'Europe/London',
        ownerUserId: userId,
      });
      const memberships = await tx.membership.findMany({ where: { organizationId: orgId } });
      expect(memberships).toMatchObject([{ userId, role: 'owner', status: 'active' }]);
      const code = await tx.pilotCode.findUniqueOrThrow({ where: { codeHash: hash('GOOD-CODE') } });
      expect(code.usedBy).toBe(userId);
      expect(code.usedAt).toBeInstanceOf(Date);
      const audit = await tx.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(audit).toMatchObject([
        { action: 'org.created', actorId: userId, objectType: 'organization', objectId: orgId },
      ]);
    }, prisma);
  });

  it('a code cannot be redeemed twice', async () => {
    await expect(signup('GOOD-CODE')).rejects.toMatchObject({ code: 'PILOT_CODE_INVALID' });
  });
});
