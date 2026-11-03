/**
 * E2E stack launcher (Playwright `webServer`). Playwright starts webServer before
 * globalSetup, so DB preparation lives here:
 *   1. use DATABASE_URL (CI / docker) or start an embedded Postgres;
 *   2. create a fresh database and run migrations as the admin (owner) role;
 *   3. provision the runtime role with the real packages/db/sql/app-role.sql and
 *      install pg-boss with `pgboss:migrate` as the owner (production shape);
 *   4. run web + worker as that role with ENFORCE_RUNTIME_ROLE=true and no
 *      MIGRATION_DATABASE_URL, so the boot-time role guard and RLS are exercised;
 *   5. record connection details for the tests in e2e/.state.json.
 * E2E_WEB_MODE=prod (playwright.offline.config.ts) runs `next build` + `next start` instead of `next dev`: the
 * offline spec needs a service worker serving stable build assets, which the dev server does not have.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { applyAppRoleSql } from '@kinetic/db/testing/app-role';
import { STATE_FILE, type E2EState } from './state';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', '..');
const repoRoot = join(webDir, '..', '..');
const PROD = process.env.E2E_WEB_MODE === 'prod';
// Not 3100: that is where `pnpm dev` runs locally, and the stack must not collide with it.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? (PROD ? 3300 : 3200));
// Not 8181 either: a locally running dev worker may hold it.
const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 8281);
const DB_NAME = 'kinetic_e2e';
const APP_ROLE = 'kinetic_app_e2e';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function withDatabase(
  url: string,
  database: string,
  credentials?: { user: string; password: string },
): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (credentials) {
    u.username = credentials.user;
    u.password = credentials.password;
  }
  return u.toString();
}

/** Kills a child and its descendants (on Windows `kill()` leaves grandchildren holding ports). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill();
  }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)),
    );
  });
}

async function main(): Promise<void> {
  const cleanups: Array<() => Promise<void> | void> = [];
  const children: ChildProcess[] = [];
  let stopping = false;
  const shutdown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) killTree(child);
    for (const cleanup of cleanups.reverse()) await Promise.resolve(cleanup()).catch(() => {});
    process.exit(code);
  };
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));

  let baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    const dir = await mkdtemp(join(tmpdir(), 'kinetic-e2e-pg-'));
    const port = await freePort();
    const embedded = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'kinetic',
      password: 'kinetic',
      port,
      persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    cleanups.push(async () => {
      await embedded.stop();
      await rm(dir, { recursive: true, force: true });
    });
    baseUrl = `postgres://kinetic:kinetic@127.0.0.1:${port}/postgres`;
  }

  const adminUrl = withDatabase(baseUrl, DB_NAME);
  const admin = new pg.Client({ connectionString: withDatabase(baseUrl, 'postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  cleanups.push(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.end();
  });

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js', {
    paths: [join(repoRoot, 'packages', 'db')],
  });
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], join(repoRoot, 'packages', 'db'), {
    ...process.env,
    DATABASE_URL: adminUrl,
  });

  // The real runtime-role script (idempotent; rotates the password of a role left by a previous run).
  const appPassword = randomBytes(24).toString('hex');
  const target = new pg.Client({ connectionString: adminUrl });
  await target.connect();
  try {
    await applyAppRoleSql(target, {
      role: APP_ROLE,
      password: appPassword,
      appSchema: 'public',
      pgbossSchema: 'pgboss',
    });
  } finally {
    await target.end();
  }
  const appUrl = withDatabase(baseUrl, DB_NAME, { user: APP_ROLE, password: appPassword });

  // Owner-only pg-boss install + queue creation, exactly as preDeployCommand does.
  const workerDir = join(repoRoot, 'apps', 'worker');
  const tsxCli = require.resolve('tsx/cli', { paths: [workerDir] });
  const ownerEnv: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: adminUrl };
  delete ownerEnv.DATABASE_URL;
  await run(process.execPath, [tsxCli, 'src/pgbossMigrate.ts'], workerDir, ownerEnv);

  const emailDir = await mkdtemp(join(tmpdir(), 'kinetic-e2e-emails-'));
  cleanups.push(() => rm(emailDir, { recursive: true, force: true }));
  const state: E2EState = { adminUrl, appUrl, emailDir };
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
  cleanups.push(() => rm(STATE_FILE, { force: true }));

  const origin = `http://localhost:${WEB_PORT}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: appUrl,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    APP_BASE_URL: origin,
    DISABLE_BREACHED_PASSWORD_CHECK: 'true',
    FAKE_PAYMENTS: 'on',
    FAKE_CALENDAR: 'on',
    DEV_EMAIL_DIR: emailDir,
    OUTBOX_POLL_INTERVAL_MS: '1000',
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    SENTRY_DSN: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    WORKER_PORT: String(WORKER_PORT),
    // Production shape: boot-time role guard on, owner credential absent, no root .env.
    ENFORCE_RUNTIME_ROLE: 'true',
    KINETIC_DOTENV: 'off',
    // Own build dir: a concurrently running `next dev` keeps `.next` to itself.
    NEXT_DIST_DIR: PROD ? '.next-e2e-prod' : '.next-e2e',
    PORT: undefined,
  };
  delete env.PORT;
  delete env.MIGRATION_DATABASE_URL;
  // A production server refuses to run without the breached-password check; specs on it seed their users.
  if (PROD) delete env.DISABLE_BREACHED_PASSWORD_CHECK;

  const nextBin = require.resolve('next/dist/bin/next', { paths: [webDir] });
  // A fresh build dir every run (S2 tooling follow-up): stale dev output breaks the first compile of a route.
  await rm(join(webDir, env.NEXT_DIST_DIR as string), { recursive: true, force: true });
  if (PROD) await run(process.execPath, [nextBin, 'build'], webDir, env);
  children.push(
    spawn(process.execPath, [tsxCli, 'src/index.ts'], { cwd: workerDir, env, stdio: 'inherit' }),
    spawn(process.execPath, [nextBin, PROD ? 'start' : 'dev', '--port', String(WEB_PORT)], {
      cwd: webDir,
      env,
      stdio: 'inherit',
    }),
  );
  for (const child of children) {
    child.once('exit', (code) => {
      if (!stopping) {
        console.error(`E2E stack: child exited with ${code}`);
        void shutdown(1);
      }
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
