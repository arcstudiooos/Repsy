import { PgBoss } from 'pg-boss';
import type { JobDefinition } from './jobs/registry';

export const PGBOSS_SCHEMA = 'pgboss';

/**
 * True when the runtime role is restricted (production, or ENFORCE_RUNTIME_ROLE=true):
 * that role cannot run DDL, so the pgboss schema must already exist, created by the
 * owner with `pnpm --filter @kinetic/worker pgboss:migrate`.
 */
export function pgBossSchemaIsPrecreated(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === 'production' || env.ENFORCE_RUNTIME_ROLE === 'true';
}

/**
 * pg-boss keeps its tables in its own schema. By default it creates and migrates
 * that schema on start; with `precreated` it does neither and fails if it is missing.
 */
export function createBoss(
  connectionString: string,
  options: { schema?: string; precreated?: boolean } = {},
): PgBoss {
  const schema = options.schema ?? PGBOSS_SCHEMA;
  return options.precreated
    ? new PgBoss({ connectionString, schema, migrate: false, createSchema: false })
    : new PgBoss({ connectionString, schema });
}

/**
 * OWNER-ONLY: installs/upgrades the pg-boss schema and creates every job queue, so the
 * restricted runtime role never needs DDL. Run with MIGRATION_DATABASE_URL.
 */
export async function migratePgBoss(
  ownerUrl: string,
  jobs: ReadonlyArray<JobDefinition<never>>,
  schema: string = PGBOSS_SCHEMA,
): Promise<void> {
  const boss = createBoss(ownerUrl, { schema });
  boss.on('error', (error) => console.error('pg-boss error:', error.message));
  await boss.start();
  try {
    for (const job of jobs) await boss.createQueue(job.name, job.queue);
  } finally {
    await boss.stop({ graceful: false });
  }
}
