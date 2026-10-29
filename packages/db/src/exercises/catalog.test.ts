import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../prisma/exercise-catalog';
import { renderCatalogInsert } from './catalogSql';

const migration = readFileSync(
  new URL('../../prisma/migrations/20260101000012_exercises/migration.sql', import.meta.url),
  'utf8',
);

describe('exercise catalog', () => {
  it('has unique ids and case-insensitively unique names, within field limits', () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((e) => e.name.toLowerCase())).size).toBe(CATALOG.length);
    for (const e of CATALOG) {
      expect(e.name.length, e.name).toBeLessThanOrEqual(80);
      expect(e.equipment.length, e.name).toBeLessThanOrEqual(40);
      expect(e.muscleGroup.length, e.name).toBeLessThanOrEqual(40);
      expect(e.movementType.length, e.name).toBeLessThanOrEqual(40);
      expect(e.instructions.length, e.name).toBeGreaterThan(20);
      expect(e.instructions.length, e.name).toBeLessThanOrEqual(2000);
      expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('migration embeds exactly the INSERT generated from the catalog', () => {
    expect(migration).toContain(renderCatalogInsert());
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
  });
});
