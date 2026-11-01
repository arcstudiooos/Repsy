/** Workout sections (PRD C9). Pure: safe in the browser. Main is the default and is not stored in content hashes. */
export const WORKOUT_SECTIONS = ['warmup', 'main', 'conditioning', 'cooldown'] as const;
export type WorkoutSection = (typeof WORKOUT_SECTIONS)[number];

export const SECTION_LABEL: Record<WorkoutSection, string> = {
  warmup: 'Warm-up',
  main: 'Main',
  conditioning: 'Conditioning',
  cooldown: 'Cool-down',
};

export const asSection = (v: unknown): WorkoutSection =>
  (WORKOUT_SECTIONS as readonly unknown[]).includes(v) ? (v as WorkoutSection) : 'main';

/**
 * The section label to show above the exercise at `index`: set where a new section starts, null otherwise. A workout
 * that is all main shows no labels, so plain workouts look as before.
 */
export function sectionStart(
  items: readonly { section?: WorkoutSection | null }[],
  index: number,
): string | null {
  if (items.every((i) => (i.section ?? 'main') === 'main')) return null;
  const here = items[index]?.section ?? 'main';
  if (index > 0 && (items[index - 1]?.section ?? 'main') === here) return null;
  return SECTION_LABEL[here];
}
