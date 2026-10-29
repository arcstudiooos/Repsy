/** `pnpm --filter @kinetic/worker pgboss:migrate` — owner-only; uses MIGRATION_DATABASE_URL. */
import { migratePgBoss } from './boss';
import { jobs } from './jobs/all';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL is required (owner connection, never the runtime role)');
  process.exit(1);
}
migratePgBoss(url, jobs)
  .then(() => console.log('pg-boss schema is up to date'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
