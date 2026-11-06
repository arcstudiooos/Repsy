/**
 * Worker pre-deploy gate (go-live 2026-11-06): only the web deploy applies migrations, so the worker could
 * otherwise go live with new code against the old schema. This waits until every migration shipped in this
 * build is finished in the database, then exits 0; after the timeout it exits 1 and Render keeps the old worker.
 * Runs as the restricted runtime role (DATABASE_URL), which can read `_prisma_migrations`.
 */
import pg from 'pg';
import {
  localMigrations,
  MIGRATIONS_DIR,
  missingMigrations,
} from '../src/deploy/waitForMigrations';

const TIMEOUT_MS = Number(process.env.MIGRATION_WAIT_TIMEOUT_MS ?? 20 * 60_000);
const POLL_MS = 10_000;

async function appliedMigrations(): Promise<string[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    return res.rows.map((r) => r.migration_name);
  } finally {
    await client.end();
  }
}

async function main() {
  const local = localMigrations(MIGRATIONS_DIR);
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const missing = missingMigrations(local, await appliedMigrations());
    if (missing.length === 0) {
      console.log(`migrations ready (${local.length} applied)`);
      return;
    }
    if (Date.now() > deadline) {
      console.error(`timed out waiting for ${missing.length} migration(s): ${missing.join(', ')}`);
      process.exit(1);
    }
    console.log(`waiting for ${missing.length} migration(s), e.g. ${missing[0]}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((error: unknown) => {
  console.error(`migration wait failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
