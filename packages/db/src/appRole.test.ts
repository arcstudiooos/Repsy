import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeRole } from './assertRuntimeRole';
import { createPrismaClient } from './client';
import type { PrismaClient } from './generated/client';
import { applyAppRoleSql, dropAppRole } from './testing/appRole';
import { createTestDb } from './testing/createTestDb';
import { withSystem } from './tenant';

const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const role = `kinetic_app_${suffix}`;
const pgbossSchema = `pgboss_${suffix}`;
const password = `pw-${suffix}`;

let drop: () => Promise<void>;
let schema: string;
let admin: pg.Client;
let appClient: PrismaClient;
const baseUrl = () => process.env.DATABASE_URL as string;
const options = () => ({ role, password, appSchema: schema, pgbossSchema });

beforeAll(async () => {
  ({ drop, schema } = await createTestDb());
  admin = new pg.Client({ connectionString: baseUrl() });
  await admin.connect();
  await applyAppRoleSql(admin, options());
  const url = new URL(baseUrl());
  url.username = role;
  url.password = password;
  appClient = createPrismaClient(url.toString(), schema);
});

afterAll(async () => {
  await appClient.$disconnect();
  await drop();
  await dropAppRole(admin, { role, pgbossSchema });
  await admin.end();
});

describe('app-role.sql', () => {
  it('creates a login role with no elevated attributes', async () => {
    const { rows } = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
         FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolcanlogin: true,
    });
  });

  it('is accepted by assertRuntimeRole and can read and write app tables', async () => {
    await expect(assertRuntimeRole(appClient, { schema })).resolves.toBeUndefined();
    const count = await withSystem(async (tx) => {
      const user = await tx.user.create({ data: { email: `${suffix}@example.test`, name: 'R' } });
      return tx.user.count({ where: { id: user.id } });
    }, appClient);
    expect(count).toBe(1);
  });

  it('cannot run DDL', async () => {
    await expect(
      appClient.$executeRawUnsafe(`CREATE TABLE "${schema}".nope (id int)`),
    ).rejects.toThrow();
  });

  it('covers tables created later by the owner (default privileges)', async () => {
    await admin.query(`CREATE TABLE "${schema}".later (id int)`);
    await expect(
      appClient.$executeRawUnsafe(`INSERT INTO "${schema}".later VALUES (1)`),
    ).resolves.toBe(1);
  });

  it('provisions the pg-boss schema for the role', async () => {
    const { rows } = await admin.query(`SELECT has_schema_privilege($1, $2, 'USAGE') AS usage`, [
      role,
      pgbossSchema,
    ]);
    expect(rows[0]?.usage).toBe(true);
  });

  it('is idempotent and rotates the password', async () => {
    await applyAppRoleSql(admin, { ...options(), password: `${password}-2` });
    const url = new URL(baseUrl());
    url.username = role;
    url.password = `${password}-2`;
    const rotated = new pg.Client({ connectionString: url.toString() });
    await rotated.connect();
    await rotated.end();
  });

  it('refuses to run without a password', async () => {
    await applyAppRoleSql(admin, options());
    await admin.query(`SELECT set_config('kinetic.app_password', '', false)`);
    const sql = (await import('node:fs')).readFileSync(
      new URL('../sql/app-role.sql', import.meta.url),
      'utf8',
    );
    await expect(admin.query(sql)).rejects.toThrow(/kinetic\.app_password/);
  });
});

describe('app-role.sql run by a non-superuser CREATEROLE owner (Render)', () => {
  const ownerRole = `kowner_${suffix}`;
  const ownerPw = `opw-${suffix}`;
  const foreignRole = `kforeign_${suffix}`;
  const appRole = `kinetic_app_o_${suffix}`;
  const bossSchema = `pgboss_o_${suffix}`;
  const secret = `s3cret-${suffix}-XYZ`;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let owner: pg.Client;

  beforeAll(async () => {
    db = await createTestDb();
    await admin.query(
      `CREATE ROLE ${ownerRole} LOGIN PASSWORD '${ownerPw}' CREATEROLE NOSUPERUSER NOBYPASSRLS`,
    );
    await admin.query(`CREATE ROLE ${foreignRole} NOLOGIN`);
    await admin.query(
      `GRANT CREATE ON DATABASE ${(await admin.query('SELECT current_database() d')).rows[0].d} TO ${ownerRole}`,
    );
    await admin.query(`ALTER SCHEMA "${db.schema}" OWNER TO ${ownerRole}`);
    await admin.query(`DO $$ DECLARE t text; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = '${db.schema}' LOOP
        EXECUTE format('ALTER TABLE %I.%I OWNER TO ${ownerRole}', '${db.schema}', t);
      END LOOP; END $$`);
    const url = new URL(baseUrl());
    url.username = ownerRole;
    url.password = ownerPw;
    owner = new pg.Client({ connectionString: url.toString() });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
    await db.drop();
    await admin.query(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`);
    await admin.query(`DROP OWNED BY ${appRole}`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${appRole}`);
    await admin.query(`DROP OWNED BY ${ownerRole}`);
    await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
    await admin.query(`DROP ROLE IF EXISTS ${foreignRole}`);
  });

  const run = (password: string, role = appRole) =>
    applyAppRoleSql(owner, { role, password, appSchema: db.schema, pgbossSchema: bossSchema });
  const attrs = async (role: string) =>
    (
      await admin.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
           FROM pg_roles WHERE rolname = $1`,
        [role],
      )
    ).rows[0];

  it('creates the role with safe attributes (success path)', async () => {
    await run(secret);
    expect(await attrs(appRole)).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolcanlogin: true,
    });
  });

  it('rotates the password with a password-only ALTER', async () => {
    await run(`${secret}-2`);
    const url = new URL(baseUrl());
    url.username = appRole;
    url.password = `${secret}-2`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    await c.end();
  });

  it('failure never leaks the password', async () => {
    // Exists, but this owner has no ADMIN on it, so ALTER ROLE is refused.
    const error = await run(secret, foreignRole).catch(
      (e: unknown) => e as Error & { where?: string },
    );
    expect(error).toBeInstanceOf(Error);
    const text = JSON.stringify([(error as Error).message, (error as { where?: string }).where]);
    expect(text).toMatch(/password failed/);
    expect(text).not.toContain(secret);
  });
});
