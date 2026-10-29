import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from './generated/client';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant } from './tenant';

let prisma: PrismaClient;
let authPrisma: PrismaClient;
let schema: string;
let drop: () => Promise<void>;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  ({ prisma, authPrisma, schema, drop } = await createTestDb());
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

  it('plain prisma sees no users; the Better Auth client sees all of them only', async () => {
    expect(await prisma.user.findMany()).toEqual([]);
    await expect(
      prisma.user.create({ data: { email: 'x@example.test', name: 'X' } }),
    ).rejects.toThrow();
    expect(await authPrisma.user.count()).toBe(1);
    // auth_context opens users only: tenant tables stay fail-closed on that pool.
    expect(await authPrisma.auditEvent.findMany()).toEqual([]);
    expect(await authPrisma.organization.findMany()).toEqual([]);
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

  it('every table with organization_id (and organizations, users) has forced RLS and a policy', async () => {
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
        AND (c.relname IN ('organizations', 'users') OR EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = ${schema}
            AND col.table_name = c.relname AND col.column_name = 'organization_id'))`;
    expect(tables.map((t) => t.relname).sort()).toEqual([
      'audit_events',
      'memberships',
      'organizations',
      'outbox_emails',
      'users',
    ]);
    for (const t of tables) {
      expect(t, t.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(t.policies, t.relname).toBeGreaterThan(0);
    }
  });

  it('policies use app_current_org', async () => {
    const policies = await prisma.$queryRaw<
      { tablename: string; qual: string | null; with_check: string | null }[]
    >`SELECT tablename, qual, with_check FROM pg_policies
      WHERE schemaname = ${schema} AND policyname = 'tenant_isolation'`;
    expect(policies.map((p) => p.tablename).sort()).toEqual([
      'audit_events',
      'memberships',
      'organizations',
      'outbox_emails',
    ]);
    for (const p of policies) {
      for (const text of [p.qual, p.with_check]) {
        expect(text, p.tablename).toContain('app_current_org()');
        expect(text, p.tablename).not.toContain('::text');
      }
    }
  });

  it('malformed org setting fails closed; empty setting returns no rows', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRaw`SELECT set_config('app.org_id', 'not-a-uuid', true)`;
        return tx.$queryRaw`SELECT 1 FROM memberships`;
      }),
    ).rejects.toMatchObject({
      meta: { driverAdapterError: { cause: { originalCode: '22P02' } } },
    });
    const auditOrgs = (setting: string | null, searchPath = `"${schema}"`) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${searchPath}`);
        if (setting !== null)
          await tx.$executeRaw`SELECT set_config('app.org_id', ${setting}, true)`;
        const rows = await tx.$queryRaw<{ organization_id: string }[]>`
          SELECT organization_id FROM ${Prisma.raw(`"${schema}".audit_events`)}`;
        return rows.map((r) => r.organization_id);
      });
    expect(await auditOrgs('')).toEqual([]);
    expect(await auditOrgs(null)).toEqual([]);
    expect(await auditOrgs(orgB)).toEqual([orgB]);
  });

  it('helper functions are schema-qualified and immune to search_path', async () => {
    const fns = await prisma.$queryRaw<{ proname: string; prosrc: string }[]>`
      SELECT p.proname, p.prosrc FROM pg_proc p
      WHERE p.pronamespace = ${schema}::regnamespace
        AND p.proname IN ('app_current_org', 'app_rls_bypass')`;
    expect(fns.map((f) => f.proname).sort()).toEqual(['app_current_org', 'app_rls_bypass']);
    for (const f of fns) expect(f.prosrc, f.proname).toContain('pg_catalog.current_setting');
    expect(fns.find((f) => f.proname === 'app_current_org')?.prosrc).toContain('pg_catalog.uuid');
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = pg_temp, public');
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgB}, true)`;
      return tx.$queryRaw<{ organization_id: string }[]>`
        SELECT organization_id FROM ${Prisma.raw(`"${schema}".audit_events`)}`;
    });
    expect(rows.map((r) => r.organization_id)).toEqual([orgB]);
  });
});
