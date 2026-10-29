import { PgBoss } from 'pg-boss';

export const PGBOSS_SCHEMA = 'pgboss';

/** pg-boss keeps its tables in its own schema, created on start. */
export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString, schema: PGBOSS_SCHEMA });
}
