import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { createAuthPrismaClient, createPrismaClient } from '../client';
import type { PrismaClient } from '../generated/client';

const APP_ROLE = 'kinetic_app_test';
const run = promisify(execFile);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const packageDir = fileURLToPath(new URL('../../', import.meta.url));

/** Creates an isolated Postgres schema, migrates it, returns a client bound to it. */
export async function createTestDb(): Promise<{
  prisma: PrismaClient;
  /** Better Auth's client (users RLS auth context), same schema and role. */
  authPrisma: PrismaClient;
  /** Name of the Postgres schema holding this test database. */
  schema: string;
  drop(): Promise<void>;
}> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is not set');

  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);

  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);

  try {
    await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: packageDir,
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
  } catch (error) {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }

  // RLS does not apply to superusers, so the app connects as a plain role.
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
  await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${APP_ROLE}`);
  await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO ${APP_ROLE}`);
  await admin.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${schema}" TO ${APP_ROLE}`);
  const appUrl = new URL(baseUrl);
  appUrl.username = APP_ROLE;
  appUrl.password = APP_ROLE;

  const prisma = createPrismaClient(appUrl.toString(), schema);
  const authPrisma = createAuthPrismaClient(appUrl.toString(), schema);
  return {
    prisma,
    authPrisma,
    schema,
    async drop() {
      await prisma.$disconnect();
      await authPrisma.$disconnect();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
