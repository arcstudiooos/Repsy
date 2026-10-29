import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './generated/client';
import { createPilotCodeRow } from './pilotCodes';
import { requireSeedPassword, seedDemo } from './seed';
import { withSystem } from './tenant';
import { createTestDb } from './testing/createTestDb';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const deps = {
  hashPassword: async (password: string) => `hashed:${sha(password)}`,
  generatePilotCode: () => ({ code: 'AAAA-BBBB', codeHash: sha('AAAABBBB') }),
};
const counts = () =>
  withSystem(
    async (tx) => ({
      users: await tx.user.count(),
      admins: await tx.user.count({ where: { isPlatformAdmin: true } }),
      orgs: await tx.organization.count(),
      clientMemberships: await tx.membership.count({ where: { role: 'client' } }),
      ownerMemberships: await tx.membership.count({ where: { role: 'owner' } }),
      credentials: await tx.account.count({ where: { providerId: 'credential' } }),
      pilotCodes: await tx.pilotCode.count(),
    }),
    prisma,
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('seedDemo', () => {
  it('seed twice yields same counts', async () => {
    const first = await seedDemo(prisma, 'seed-password-1', deps);
    const afterFirst = await counts();
    expect(afterFirst).toEqual({
      users: 5,
      admins: 1,
      orgs: 1,
      clientMemberships: 3,
      ownerMemberships: 1,
      credentials: 5,
      pilotCodes: 1,
    });
    expect(first.pilotCode).toBe('AAAA-BBBB');

    const second = await seedDemo(prisma, 'seed-password-1', deps);
    expect(await counts()).toEqual(afterFirst);
    expect(second.pilotCode).toBeNull();
  });

  it('stores only the hash of the pilot code and uses synthetic example.test emails', async () => {
    const stored = await prisma.pilotCode.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.codeHash).toBe(sha('AAAABBBB'));
    expect(JSON.stringify(stored)).not.toContain('AAAA-BBBB');
    const users = await prisma.user.findMany();
    expect(users.every((u) => u.email.endsWith('@example.test'))).toBe(true);
    expect(users.map((u) => u.email)).toEqual(
      expect.arrayContaining(['admin@example.test', 'coach@example.test']),
    );
  });

  it('never stores the plaintext password', async () => {
    const accounts = await prisma.account.findMany();
    expect(accounts.every((a) => a.password === `hashed:${sha('seed-password-1')}`)).toBe(true);
  });
});

describe('requireSeedPassword', () => {
  it('refuses when unset, blank or too short', () => {
    expect(() => requireSeedPassword({})).toThrow(/SEED_PASSWORD/);
    expect(() => requireSeedPassword({ SEED_PASSWORD: '' })).toThrow(/SEED_PASSWORD/);
    expect(() => requireSeedPassword({ SEED_PASSWORD: 'short' })).toThrow(/12/);
    expect(requireSeedPassword({ SEED_PASSWORD: 'long-enough-pw' })).toBe('long-enough-pw');
  });
});

describe('createPilotCodeRow', () => {
  it('inserts a code expiring in N days created by the platform admin', async () => {
    const before = Date.now();
    const row = await createPilotCodeRow(prisma, { codeHash: sha('ZZZZ'), expiresInDays: 10 });
    const stored = await prisma.pilotCode.findUniqueOrThrow({ where: { id: row.id } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.test' } });
    expect(stored.createdBy).toBe(admin.id);
    const days = (stored.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(9.99);
    expect(days).toBeLessThan(10.01);
  });
});
