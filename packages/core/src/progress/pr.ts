/**
 * Personal-record helpers (PRD E6, D11). Pure: no database or server imports, so browser components can use them
 * (`@kinetic/core/pr`).
 */

/** Sets above this many reps are left out of the estimated 1RM: the formula is unreliable for long sets. */
export const E1RM_MAX_REPS = 12;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Epley; a single is its own weight. Null outside 1..E1RM_MAX_REPS reps or without a load. */
export function estimateOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || weightKg <= 0 || reps === null || reps < 1 || reps > E1RM_MAX_REPS) {
    return null;
  }
  return reps === 1 ? weightKg : round1(weightKg * (1 + reps / 30));
}

/** A client's best marks per exercise before a session (PRD D11), for PR badges in the logger. */
export interface ExerciseBest {
  heaviestKg: number | null;
  estimatedOneRepMaxKg: number | null;
  mostReps: number | null;
  longestSeconds: number | null;
  longestMeters: number | null;
}

/** Whether a set beats the client's earlier bests on load, estimated 1RM, reps (bodyweight), duration or distance. */
export function isPersonalRecord(
  set: {
    reps: number | null;
    weightKg: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
  },
  best: ExerciseBest | undefined,
): boolean {
  if (!best) return false;
  const beats = (v: number | null, b: number | null) => v !== null && v > 0 && b !== null && v > b;
  if (set.weightKg !== null && set.weightKg > 0) {
    return (
      beats(set.weightKg, best.heaviestKg) ||
      beats(estimateOneRepMax(set.weightKg, set.reps), best.estimatedOneRepMaxKg)
    );
  }
  return (
    (best.heaviestKg === null && beats(set.reps, best.mostReps)) ||
    beats(set.durationSeconds, best.longestSeconds) ||
    beats(set.distanceM, best.longestMeters)
  );
}
