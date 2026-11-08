import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@repsy/core';
import { createPrismaClient } from '@repsy/db';
import { applyAppRoleSql, dropAppRole } from '@repsy/db/testing/app-role';
import { createBoss, migratePgBoss, pgBossSchemaIsPrecreated } from './boss';
import { jobs } from './jobs/all';
import { registerJobs } from './jobs/registry';

const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const role = `repsy_app_${suffix}`;
const password = `pw-${suffix}`;
const emptySchema = `pgboss_e_${suffix}`;
const readySchema = `pgboss_r_${suffix}`;
const baseUrl = () => process.env.DATABASE_URL as string;
const silent = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));

let admin: pg.Client;
let appUrl: string;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: baseUrl() });
  await admin.connect();
  await applyAppRoleSql(admin, { role, password, appSchema: 'public', pgbossSchema: emptySchema });
  await applyAppRoleSql(admin, { role, password, appSchema: 'public', pgbossSchema: readySchema });
  const url = new URL(baseUrl());
  url.username = role;
  url.password = password;
  appUrl = url.toString();
  // Owner-only step, as `pnpm --filter @repsy/worker pgboss:migrate` runs it.
  await migratePgBoss(baseUrl(), jobs, readySchema);
});

afterAll(async () => {
  await dropAppRole(admin, { role, pgbossSchema: readySchema });
  await admin.query(`DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE`);
  await admin.end();
});

describe('pgBossSchemaIsPrecreated', () => {
  it('is true in production or when the role guard is enforced', () => {
    expect(pgBossSchemaIsPrecreated({})).toBe(false);
    expect(pgBossSchemaIsPrecreated({ NODE_ENV: 'development' })).toBe(false);
    expect(pgBossSchemaIsPrecreated({ NODE_ENV: 'production' })).toBe(true);
    expect(pgBossSchemaIsPrecreated({ ENFORCE_RUNTIME_ROLE: 'true' })).toBe(true);
  });
});

describe('pg-boss with the restricted runtime role', () => {
  it('the runtime role has no CREATE on the pgboss schema', async () => {
    const { rows } = await admin.query(`SELECT has_schema_privilege($1, $2, 'CREATE') AS c`, [
      role,
      readySchema,
    ]);
    expect(rows[0]?.c).toBe(false);
  });

  it('starts and registers jobs against a pre-migrated schema without DDL rights', async () => {
    const prisma = createPrismaClient(appUrl);
    const boss = createBoss(appUrl, { schema: readySchema, precreated: true });
    try {
      await boss.start();
      await registerJobs(boss, jobs, {
        prisma,
        port: { send: async () => undefined },
        logger: silent,
      });
    } finally {
      await boss.stop({ graceful: false });
      await prisma.$disconnect();
    }
  });

  it('does not create a missing schema when precreated', async () => {
    const boss = createBoss(appUrl, { schema: emptySchema, precreated: true });
    try {
      await expect(boss.start()).rejects.toThrow();
    } finally {
      await boss.stop({ graceful: false }).catch(() => undefined);
    }
  });
});
