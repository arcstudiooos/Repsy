import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { createPrismaClient } from '../client';
import type { PrismaClient } from '../generated/client';

const run = promisify(execFile);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const packageDir = fileURLToPath(new URL('../../', import.meta.url));

/** Creates an isolated Postgres schema, migrates it, returns a client bound to it. */
export async function createTestDb(): Promise<{
  prisma: PrismaClient;
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

  const prisma = createPrismaClient(baseUrl, schema);
  return {
    prisma,
    async drop() {
      await prisma.$disconnect();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
