/**
 * E2E stack launcher (Playwright `webServer`). Playwright starts webServer before
 * globalSetup, so DB preparation lives here:
 *   1. use DATABASE_URL (CI / docker) or start an embedded Postgres;
 *   2. create a fresh database and run migrations as the admin role;
 *   3. run web + worker as a NON-superuser role so RLS is exercised;
 *   4. record connection details for the tests in e2e/.state.json.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { STATE_FILE, type E2EState } from './state';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', '..');
const repoRoot = join(webDir, '..', '..');
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 8181);
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

function withDatabase(url: string, database: string, user?: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user;
    u.password = user;
  }
  return u.toString();
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
    for (const child of children) child.kill();
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
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
  await admin.query(`GRANT CREATE ON DATABASE ${DB_NAME} TO ${APP_ROLE}`); // pg-boss schema
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

  const appUrl = withDatabase(baseUrl, DB_NAME, APP_ROLE);
  const target = new pg.Client({ connectionString: adminUrl });
  await target.connect();
  await target.query(`GRANT ALL ON SCHEMA public TO ${APP_ROLE}`);
  await target.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await target.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  await target.end();

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
    DEV_EMAIL_DIR: emailDir,
    OUTBOX_POLL_INTERVAL_MS: '1000',
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    SENTRY_DSN: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    WORKER_PORT: String(WORKER_PORT),
    PORT: undefined,
  };
  delete env.PORT;

  const nextBin = require.resolve('next/dist/bin/next', { paths: [webDir] });
  const workerDir = join(repoRoot, 'apps', 'worker');
  const tsxCli = require.resolve('tsx/cli', { paths: [workerDir] });
  children.push(
    spawn(process.execPath, [tsxCli, 'src/index.ts'], { cwd: workerDir, env, stdio: 'inherit' }),
    spawn(process.execPath, [nextBin, 'dev', '--port', String(WEB_PORT)], {
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
