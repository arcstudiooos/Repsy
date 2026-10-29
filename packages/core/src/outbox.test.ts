import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { enqueueEmail } from './outbox';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;
let userId: string;

const input = (idempotencyKey: string) => ({
  kind: 'invite',
  toUserId: userId,
  templateKey: 'invite',
  payload: { link: 'http://localhost:3000/x' },
  idempotencyKey,
});
const rows = () => withSystem((tx) => tx.outboxEmail.findMany(), prisma);

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'u@example.test', name: 'U' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
    });
    userId = user.id;
    orgId = org.id;
  }, prisma);
});

afterAll(async () => {
  await drop();
});

describe('enqueueEmail', () => {
  it('same idempotencyKey enqueued twice → one row', async () => {
    const first = await withTenant(orgId, (tx) => enqueueEmail(tx, input('dup')), prisma);
    const second = await withTenant(orgId, (tx) => enqueueEmail(tx, input('dup')), prisma);
    expect([first, second]).toEqual([true, false]);
    const all = (await rows()).filter((r) => r.idempotencyKey === 'dup');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ organizationId: orgId, status: 'pending', attempts: 0 });
  });

  it('rolls back with the caller transaction', async () => {
    await expect(
      withTenant(
        orgId,
        async (tx) => {
          await enqueueEmail(tx, input('rolled-back'));
          throw new Error('boom');
        },
        prisma,
      ),
    ).rejects.toThrow('boom');
    expect((await rows()).some((r) => r.idempotencyKey === 'rolled-back')).toBe(false);
  });
});
