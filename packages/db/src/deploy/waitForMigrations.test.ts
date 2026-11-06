import { describe, expect, it } from 'vitest';
import { localMigrations, MIGRATIONS_DIR, missingMigrations } from './waitForMigrations';

describe('worker migration gate', () => {
  it('lists the shipped migrations in order', () => {
    const local = localMigrations(MIGRATIONS_DIR);
    expect(local.length).toBeGreaterThan(80);
    expect([...local].sort()).toEqual(local);
  });
  it('reports only the migrations the database has not finished', () => {
    expect(missingMigrations(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
    expect(missingMigrations(['a'], ['a', 'z'])).toEqual([]);
  });
});
