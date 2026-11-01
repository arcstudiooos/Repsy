import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { twoFactorStatus } from './twoFactor';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('two-step sign-in status (PRD A8)', () => {
  it('is required of the owner only once the workspace has a second coach', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const status = () => runAs(prisma, org.coach, (tx) => twoFactorStatus(tx, org.coach));
    expect(await status()).toEqual({ enabled: false, required: false });
    await withSystem(async (tx) => {
      const u = await tx.user.create({
        data: { email: `c2-${Date.now()}@example.test`, name: 'C2' },
      });
      await tx.membership.create({
        data: { userId: u.id, organizationId: org.orgId, role: 'coach' },
      });
      await tx.user.update({ where: { id: org.coach.userId }, data: { twoFactorEnabled: true } });
    }, prisma);
    expect(await status()).toEqual({ enabled: true, required: true });
    // Clients are never required to.
    expect(await runAs(prisma, w.client, (tx) => twoFactorStatus(tx, w.client))).toEqual({
      enabled: false,
      required: false,
    });
  });
});
