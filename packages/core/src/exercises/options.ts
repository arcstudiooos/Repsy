// Pure constants (no server imports) so client components can import them via
// `@kinetic/core/exercise-options` without pulling the database layer into the bundle.

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
