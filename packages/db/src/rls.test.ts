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
      'client_invites',
      'client_pauses',
      'clients',
      'exercises',
      'memberships',
      'organizations',
      'outbox_emails',
      'program_assignments',
      'program_drafts',
      'program_slots',
      'program_versions',
      'programs',
      'set_log_revisions',
      'set_logs',
      'users',
      'workout_sessions',
      'workout_version_exercises',
      'workout_versions',
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
      'client_invites',
      'client_pauses',
      'clients',
      'memberships',
      'organizations',
      'outbox_emails',
      'program_assignments',
      'program_drafts',
      'program_slots',
      'program_versions',
      'programs',
      'set_log_revisions',
      'set_logs',
      'workout_sessions',
      'workout_version_exercises',
      'workout_versions',
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

describe('exercises (global catalog + org rows)', () => {
  // Uses a different policy shape from tenant_isolation: globals are readable by every
  // organization, writable by none. The generic guard above still covers forced RLS + a policy.
  const ex = (organizationId: string | null, name: string) => ({
    organizationId,
    name,
    equipment: 'Other',
    muscleGroup: 'Core',
    movementType: 'Core',
    trackingType: 'duration' as const,
  });
  const asOrg = <T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
      return fn(tx);
    });

  it('uses the globals-readable policy plus restrictive immutability policies', async () => {
    const rows = await prisma.$queryRaw<{ polname: string; permissive: boolean; qual: string }[]>`
      SELECT p.polname, p.polpermissive AS permissive, pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relnamespace = ${schema}::regnamespace AND c.relname = 'exercises'`;
    expect(rows.map((r) => r.polname).sort()).toEqual([
      'exercise_globals_immutable_delete',
      'exercise_globals_immutable_update',
      'exercise_scope',
    ]);
    const scope = rows.find((r) => r.polname === 'exercise_scope');
    expect(scope?.qual).toContain('organization_id IS NULL');
    expect(scope?.qual).toContain('app_current_org()');
    for (const r of rows.filter((x) => x.polname !== 'exercise_scope')) {
      expect(r.permissive, r.polname).toBe(false);
    }
  });

  it('a raw insert of a global row under app.org_id is rejected', async () => {
    await expect(
      asOrg(orgA, (tx) => tx.exercise.create({ data: ex(null, 'Sneaky') })),
    ).rejects.toThrow();
  });

  it('cannot insert a row for another org', async () => {
    await expect(
      asOrg(orgA, (tx) => tx.exercise.create({ data: ex(orgB, 'Other') })),
    ).rejects.toThrow();
  });

  it('every org sees globals and only its own custom rows; raw writes cannot touch globals', async () => {
    await asOrg(orgA, (tx) => tx.exercise.create({ data: ex(orgA, 'Only A') }));
    const names = (orgId: string) =>
      asOrg(orgId, async (tx) => (await tx.exercise.findMany()).map((e) => e.name));
    const a = await names(orgA);
    const b = await names(orgB);
    expect(a).toContain('Only A');
    expect(b).not.toContain('Only A');
    expect(a.filter((n) => n !== 'Only A').sort()).toEqual([...b].sort());
    expect(b.length).toBeGreaterThanOrEqual(75);

    const del = await asOrg(orgB, (tx) =>
      tx.exercise.deleteMany({ where: { organizationId: null } }),
    );
    expect(del.count).toBe(0);
    const upd = await asOrg(orgB, (tx) =>
      tx.exercise.updateMany({ where: { organizationId: null }, data: { name: 'x' } }),
    );
    expect(upd.count).toBe(0);
    expect((await names(orgB)).length).toBe(b.length);
  });
});

describe('user-keyed tables (coach_profiles, notification_preferences)', () => {
  let userA: string;
  let userB: string;
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const a = await tx.user.create({ data: { email: 'pa@example.test', name: 'PA' } });
      const b = await tx.user.create({ data: { email: 'pb@example.test', name: 'PB' } });
      userA = a.id;
      userB = b.id;
      for (const userId of [a.id, b.id]) {
        await tx.coachProfile.create({ data: { userId, bio: `bio-${userId}` } });
        await tx.notificationPreference.create({ data: { userId } });
      }
    }, prisma);
  });

  it('have forced RLS and a self_row policy keyed on app.user_id', async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; qual: string }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
        pg_get_expr(p.polqual, p.polrelid) AS qual
      FROM pg_class c JOIN pg_policy p ON p.polrelid = c.oid
      WHERE c.relnamespace = ${schema}::regnamespace
        AND c.relname IN ('coach_profiles', 'notification_preferences')
        AND p.polname = 'self_row'`;
    expect(rows.map((r) => r.relname).sort()).toEqual([
      'coach_profiles',
      'notification_preferences',
    ]);
    for (const r of rows) {
      expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(r.qual, r.relname).toContain('app.user_id');
    }
  });

  it('plain prisma (no user) sees nothing', async () => {
    expect(await prisma.coachProfile.findMany()).toEqual([]);
    expect(await prisma.notificationPreference.findMany()).toEqual([]);
  });

  it("user A cannot read or update user B's profile or preferences in a tenant tx", async () => {
    await withTenant(
      orgA,
      async (tx) => {
        const mine = await tx.coachProfile.findMany();
        expect(mine.map((r) => r.userId)).toEqual([userA]);
        expect(await tx.coachProfile.findFirst({ where: { userId: userB } })).toBeNull();
        expect(await tx.notificationPreference.findFirst({ where: { userId: userB } })).toBeNull();
        const upd = await tx.coachProfile.updateMany({
          where: { userId: userB },
          data: { bio: 'hacked' },
        });
        expect(upd.count).toBe(0);
        const upd2 = await tx.notificationPreference.updateMany({
          where: { userId: userB },
          data: { marketingOptIn: true },
        });
        expect(upd2.count).toBe(0);
        await expect(
          tx.notificationPreference.create({ data: { userId: userB } }),
        ).rejects.toThrow();
      },
      prisma,
      { userId: userA },
    );
    const b = await withSystem(
      (tx) => tx.coachProfile.findUnique({ where: { userId: userB } }),
      prisma,
    );
    expect(b?.bio).toBe(`bio-${userB}`);
  });
});
