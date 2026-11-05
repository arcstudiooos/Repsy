import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * Starts a throwaway embedded Postgres only when DATABASE_URL is unset
 * (local dev). CI provides DATABASE_URL via a Postgres service container.
 */
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.DATABASE_URL) return undefined;

  // Imported only when needed: embedded-postgres registers async-exit-hook, whose `beforeExit` handler calls
  // process.exit(0) and so turns a failed run (vitest sets process.exitCode = 1) into exit 0.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  keepFailureExitCode();

  const dir = await mkdtemp(join(tmpdir(), 'kinetic-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'kinetic',
    password: 'kinetic',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('kinetic_test');
  process.env.DATABASE_URL = `postgres://kinetic:kinetic@127.0.0.1:${port}/kinetic_test`;

  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

/** Lets a non-zero process.exitCode (failed tests) win over the exit hook's explicit process.exit(0). */
function keepFailureExitCode(): void {
  const exit = process.exit.bind(process);
  process.exit = ((code?: number | string | null) =>
    exit(code === 0 && process.exitCode ? process.exitCode : code)) as typeof process.exit;
}
