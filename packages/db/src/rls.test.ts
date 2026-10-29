import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from './generated/client';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant } from './tenant';

let prisma: PrismaClient;
let schema: string;
let drop: () => Promise<void>;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  ({ prisma, schema, drop } = await createTestDb());
  await withSystem(async (tx) => {
    const u = await tx.user.create({ data: { email: 'r@example.test', name: 'R' } });
    const a = await tx.organization.create({
      data: { name: 'A', timezone: 'UTC', ownerUserId: u.id },
    });
    const b = await tx.organization.create({
      data: { name: 'B', timezone: 'UTC', ownerUserId: u.id },
    });
    orgA = a.id;
    orgB = b.id;
    for (const organizationId of [a.id, b.id]) {
      await tx.auditEvent.create({
        data: { organizationId, objectType: 't', objectId: 'o', action: 'seed' },
      });
    }
  }, prisma);
});

afterAll(async () => {
  await drop();
});

describe('row level security', () => {
  it('plain prisma is fail-closed on tenant tables', async () => {
    expect(await prisma.auditEvent.findMany()).toEqual([]);
    expect(await prisma.organization.findMany()).toEqual([]);
    await expect(
      prisma.auditEvent.create({
        data: { organizationId: orgA, objectType: 't', objectId: 'x', action: 'a' },
      }),
    ).rejects.toThrow();
  });

  it('raw select with app.org_id set sees only that org', async () => {
    const seen = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgB}, true)`;
      return tx.$queryRaw<{ organization_id: string }[]>`SELECT organization_id FROM audit_events`;
    });
    expect(seen.map((r) => r.organization_id)).toEqual([orgB]);
  });

  it('cannot insert into another org even bypassing the extension', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${orgA}, true)`;
        await tx.auditEvent.create({
          data: { organizationId: orgB, objectType: 't', objectId: 'x', action: 'a' },
        });
      }),
    ).rejects.toThrow();
    expect(await withTenant(orgA, (tx) => tx.auditEvent.count(), prisma)).toBe(1);
  });

  it('every table with organization_id (and organizations) has forced RLS and a policy', async () => {
    const tables = await prisma.$queryRaw<
      {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
      }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      WHERE c.relkind = 'r'
        AND c.relnamespace = ${schema}::regnamespace
        AND (c.relname = 'organizations' OR EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = ${schema}
            AND col.table_name = c.relname AND col.column_name = 'organization_id'))`;
    expect(tables.map((t) => t.relname).sort()).toEqual([
      'audit_events',
      'memberships',
      'organizations',
      'outbox_emails',
    ]);
    for (const t of tables) {
      expect(t, t.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(t.policies, t.relname).toBeGreaterThan(0);
    }
  });
});
