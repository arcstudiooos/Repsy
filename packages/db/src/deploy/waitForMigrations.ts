import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Migration folder names shipped with this build (each holds a migration.sql). */
export function localMigrations(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** The shipped migrations the database has not finished applying yet. */
export function missingMigrations(local: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return local.filter((name) => !done.has(name));
}

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
