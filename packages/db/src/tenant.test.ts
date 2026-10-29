import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './generated/client';
import { createTestDb } from './testing/createTestDb';
import { withTenant } from './tenant';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgA: string;
let orgB: string;

async function seedOrg(name: string, email: string): Promise<string> {
  const user = await prisma.user.create({ data: { email, name } });
  const org = await prisma.organization.create({
    data: { name, timezone: 'UTC', ownerUserId: user.id },
  });
  return org.id;
}

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  orgA = await seedOrg('A', 'a@example.test');
  orgB = await seedOrg('B', 'b@example.test');
  for (const [organizationId, objectId] of [
    [orgA, 'obj-a'],
    [orgB, 'obj-b'],
  ] as const) {
    await prisma.auditEvent.create({
      data: { organizationId, objectType: 'test', objectId, action: 'seed' },
    });
  }
});

afterAll(async () => {
  await drop();
});

describe('withTenant', () => {
  it('only returns rows of that org', async () => {
    const rows = await withTenant(orgA, (tx) => tx.auditEvent.findMany(), prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(orgA);
  });

  it('sets organizationId on create, ignoring a supplied foreign one', async () => {
    const row = await withTenant(
      orgA,
      (tx) =>
        tx.auditEvent.create({
          data: { organizationId: orgB, objectType: 't', objectId: 'x', action: 'create' },
        }),
      prisma,
    );
    expect(row.organizationId).toBe(orgA);
  });

  it('cannot read another org row by unique id', async () => {
    const other = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgB } });
    const found = await withTenant(
      orgA,
      (tx) => tx.auditEvent.findUnique({ where: { id: other.id } }),
      prisma,
    );
    expect(found).toBeNull();
  });

  it('leaves models without organizationId untouched', async () => {
    const users = await withTenant(orgA, (tx) => tx.user.findMany(), prisma);
    expect(users).toHaveLength(2);
  });

  it('counts only own rows', async () => {
    const n = await withTenant(orgB, (tx) => tx.auditEvent.count(), prisma);
    expect(n).toBe(1);
  });
});
