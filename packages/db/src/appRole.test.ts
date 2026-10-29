import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeRole } from './assertRuntimeRole';
import { createPrismaClient } from './client';
import type { PrismaClient } from './generated/client';
import { applyAppRoleSql, dropAppRole } from './testing/appRole';
import { createTestDb } from './testing/createTestDb';

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
    const user = await appClient.user.create({
      data: { email: `${suffix}@example.test`, name: 'R' },
    });
    expect(await appClient.user.count({ where: { id: user.id } })).toBe(1);
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
