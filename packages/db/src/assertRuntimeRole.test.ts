import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertRuntimeRole, assertRuntimeRoleIfEnforced } from './assertRuntimeRole';
import { createPrismaClient } from './client';
import type { PrismaClient } from './generated/client';
import { createTestDb } from './testing/createTestDb';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let schema: string;
let admin: pg.Client;
const baseUrl = () => process.env.DATABASE_URL as string;
const opened: PrismaClient[] = [];

const clientAs = (role: string, inSchema: string): PrismaClient => {
  const url = new URL(baseUrl());
  url.username = role;
  url.password = role;
  const client = createPrismaClient(url.toString(), inSchema);
  opened.push(client);
  return client;
};

beforeAll(async () => {
  ({ prisma, drop, schema } = await createTestDb());
  admin = new pg.Client({ connectionString: baseUrl() });
  await admin.connect();
});

afterAll(async () => {
  for (const client of opened) await client.$disconnect();
  await admin.end();
  await drop();
});

describe('assertRuntimeRole', () => {
  it('passes for a plain non-owner role', async () => {
    await expect(assertRuntimeRole(prisma, { schema })).resolves.toBeUndefined();
  });

  it('throws for a superuser connection', async () => {
    const superClient = createPrismaClient(baseUrl(), schema);
    opened.push(superClient);
    await expect(assertRuntimeRole(superClient, { schema })).rejects.toThrow(/superuser/i);
  });

  it('throws for a BYPASSRLS role', async () => {
    const role = `bypass_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}' NOSUPERUSER BYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
    try {
      await expect(assertRuntimeRole(clientAs(role, schema), { schema })).rejects.toThrow(
        /BYPASSRLS/i,
      );
    } finally {
      await opened.pop()?.$disconnect();
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    }
  });

  it('throws for a role that owns tables in the app schema', async () => {
    const role = `owner_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
    await admin.query(`ALTER TABLE "${schema}".users OWNER TO ${role}`);
    try {
      await expect(assertRuntimeRole(clientAs(role, schema), { schema })).rejects.toThrow(/owns/i);
    } finally {
      await opened.pop()?.$disconnect();
      await admin.query(`ALTER TABLE "${schema}".users OWNER TO CURRENT_USER`);
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    }
  });
});

describe('assertRuntimeRoleIfEnforced', () => {
  const superClient = () => {
    const client = createPrismaClient(baseUrl(), schema);
    opened.push(client);
    return client;
  };

  it('skips outside production unless ENFORCE_RUNTIME_ROLE=true', async () => {
    await expect(assertRuntimeRoleIfEnforced(superClient(), {})).resolves.toBeUndefined();
    await expect(
      assertRuntimeRoleIfEnforced(superClient(), { NODE_ENV: 'development' }),
    ).resolves.toBeUndefined();
  });

  it('enforces in production and with ENFORCE_RUNTIME_ROLE=true', async () => {
    await expect(
      assertRuntimeRoleIfEnforced(superClient(), { NODE_ENV: 'production' }),
    ).rejects.toThrow(/superuser/i);
    await expect(
      assertRuntimeRoleIfEnforced(superClient(), { ENFORCE_RUNTIME_ROLE: 'true' }),
    ).rejects.toThrow(/superuser/i);
  });
});
