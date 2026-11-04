import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const packageDir = fileURLToPath(new URL('../', import.meta.url));

/**
 * Managed Postgres (Render, Neon, Supabase) never hands out a superuser: the database owner is a plain
 * NOSUPERUSER role. Every migration must apply as such a role. The other suites migrate as a superuser, which
 * hid that a function-level `SET app.bypass_rls` needs one (Postgres 15+), so the first Render deploy failed.
 */
describe('migrations as a non-superuser owner', () => {
  const role = `kinetic_owner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const schema = `owner_${randomUUID().replace(/-/g, '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });

  it('apply cleanly', async () => {
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${role}' NOSUPERUSER NOBYPASSRLS CREATEROLE`,
    );
    await admin.query(`CREATE SCHEMA "${schema}" AUTHORIZATION ${role}`);
    const { rows } = await admin.query<{ rolsuper: boolean }>(
      `SELECT rolsuper FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    expect(rows[0]?.rolsuper).toBe(false);

    const url = new URL(process.env.DATABASE_URL ?? '');
    url.username = role;
    url.password = role;
    url.searchParams.set('schema', schema);
    const { stdout } = await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: packageDir,
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
    expect(stdout).toContain('successfully applied');
  });
});
