import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createClient } from '../clients/clients';
import { createTestDb } from '@repsy/db/testing';
import { DomainError } from '../errors';
import { hashPilotCode } from './pilotCode';
import { canonicalTimezone } from '../timezone';
import { signupCoach } from './signupCoach';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let adminId: string;
let userId: string;

const hash = hashPilotCode;
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

  it('accepts lowercase and hyphenless input', async () => {
    await seedCode('MIXED-Case-9');
    await expect(signup('mixedcase9')).resolves.toHaveProperty('orgId');
  });

  it('stores the canonical zone for a browser alias; an invalid zone is VALIDATION and leaves the code unused', async () => {
    await seedCode('ZONE-CODE');
    const bad = await withSystem(
      (tx) => signupCoach(tx, { ...input('ZONE-CODE'), timezone: '+05:30' }),
      prisma,
    ).catch((e: unknown) => e);
    expect(bad).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { timezone: [expect.any(String)] },
    });
    const { orgId } = await withSystem(
      (tx) => signupCoach(tx, { ...input('ZONE-CODE'), timezone: 'Asia/Kolkata' }),
      prisma,
    );
    const org = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: orgId } }),
      prisma,
    );
    expect(org.timezone).toBe(canonicalTimezone('Asia/Kolkata'));
  });

  it('a code cannot be redeemed twice', async () => {
    await expect(signup('GOOD-CODE')).rejects.toMatchObject({ code: 'PILOT_CODE_INVALID' });
  });
});

describe('self-serve trial (PRD A4)', () => {
  it('a blank code makes a 7-day trial for 3 clients; an ended trial takes no new clients', async () => {
    const user = await withSystem(
      (tx) => tx.user.create({ data: { email: 'trial@example.test', name: 'T' } }),
      prisma,
    );
    const { orgId } = await withSystem(
      (tx) =>
        signupCoach(tx, {
          userId: user.id,
          pilotCode: '',
          orgName: 'Trial Gym',
          timezone: 'Europe/London',
        }),
      prisma,
    );
    const org = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: orgId } }),
      prisma,
    );
    expect(org).toMatchObject({ plan: 'trial', activeClientLimit: 3 });
    const days = (org.trialEndsAt!.getTime() - Date.now()) / day;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const coach = { userId: user.id, orgId, role: 'owner' as const, isPlatformAdmin: false };
    const add = (email: string) =>
      withTenant(orgId, (tx) => createClient(tx, coach, { name: 'C', email }), prisma, {
        userId: user.id,
      });
    await add('one@example.test');
    await withSystem(
      (tx) =>
        tx.organization.update({
          where: { id: orgId },
          data: { trialEndsAt: new Date(Date.now() - 1000) },
        }),
      prisma,
    );
    await expect(add('two@example.test')).rejects.toMatchObject({ code: 'TRIAL_ENDED' });
  });
});
