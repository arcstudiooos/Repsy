import { CATALOG, type CatalogExercise } from '../../prisma/exercise-catalog';

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

const row = (e: CatalogExercise) =>
  `  (${lit(e.id)}, ${lit(e.name)}, ${lit(e.equipment)}, ${lit(e.muscleGroup)}, ${lit(e.movementType)}, ${lit(e.trackingType)}::"tracking_type", ${lit(e.instructions)})`;

/** The INSERT block embedded in migration 20260101000012_exercises (global rows, organization_id NULL). */
export function renderCatalogInsert(catalog: readonly CatalogExercise[] = CATALOG): string {
  return [
    'INSERT INTO "exercises" ("id", "name", "equipment", "muscle_group", "movement_type", "tracking_type", "instructions") VALUES',
    catalog.map(row).join(',\n'),
    'ON CONFLICT ("id") DO NOTHING;',
    '',
  ].join('\n');
}
