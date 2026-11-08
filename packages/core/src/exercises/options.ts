// Pure constants (no server imports) so client components can import them via
// `@repsy/core/exercise-options` without pulling the database layer into the bundle.

export const TRACKING_TYPES = ['reps_load', 'duration', 'distance'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

/** Suggested values for the UI. Stored values are free text (max 40), so custom rows may differ. */
export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full body',
  'Cardio',
] as const;
export const EQUIPMENT = [
  'Barbell',
  'Dumbbell',
  'Kettlebell',
  'Machine',
  'Cable',
  'Band',
  'Bodyweight',
  'Cardio machine',
  'Other',
] as const;
export const MOVEMENT_TYPES = [
  'Push',
  'Pull',
  'Squat',
  'Hinge',
  'Lunge',
  'Carry',
  'Core',
  'Isolation',
  'Cardio',
] as const;

/**
 * PRD B13: true when an exercise needs equipment the client's kit lacks. Bodyweight and "Other" never warn, and an
 * empty kit (not recorded) never warns.
 */
export function outsideKit(equipment: string, kit: readonly string[]): boolean {
  if (kit.length === 0 || equipment === 'Bodyweight' || equipment === 'Other') return false;
  return !kit.includes(equipment);
}
