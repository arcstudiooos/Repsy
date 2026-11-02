/**
 * PRD C12: progression rules that fill an exercise's later weeks from week one's sets. Pure: the builder previews
 * them before anything is saved. Loads are in whatever units the caller uses (the builder: the coach's units).
 * "While RPE is 8 or less" can't be known ahead of time, so it becomes each generated set's target RPE (D-012).
 */
export type ProgressionRule =
  | { kind: 'load'; step: number; rpeMax?: number }
  | { kind: 'reps'; step: number; maxReps: number; loadStep: number; rpeMax?: number };

export interface ProgressionSet {
  reps?: number;
  loadKg?: number;
  rpe?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A plain-language rule, for the preview and the exercise note. */
export function describeRule(rule: ProgressionRule, units: string): string {
  const rpe = rule.rpeMax ? ` while RPE is ${rule.rpeMax} or less` : '';
  return rule.kind === 'load'
    ? `+${rule.step} ${units} per week${rpe}`
    : `+${rule.step} rep${rule.step === 1 ? '' : 's'} per week up to ${rule.maxReps}, then +${rule.loadStep} ${units} and back to the starting reps${rpe}`;
}

/**
 * The sets for `weeksAfter` weeks after the base week (1 = the next week). Sets without reps or load stay as they
 * are; a rule never removes a set.
 */
export function progressSets(
  base: ProgressionSet[],
  rule: ProgressionRule,
  weeksAfter: number,
): ProgressionSet[] {
  return base.map((s) => {
    const out: ProgressionSet = { ...s };
    if (rule.kind === 'load') {
      if (s.loadKg !== undefined) out.loadKg = round(s.loadKg + rule.step * weeksAfter);
    } else if (s.reps !== undefined) {
      // Double progression: reps climb to the top of the range, then the load goes up and reps start again.
      let reps = s.reps;
      let load = s.loadKg;
      for (let i = 0; i < weeksAfter; i++) {
        if (reps + rule.step <= rule.maxReps) reps += rule.step;
        else {
          reps = s.reps;
          if (load !== undefined) load = round(load + rule.loadStep);
        }
      }
      out.reps = reps;
      if (load !== undefined) out.loadKg = load;
    }
    if (rule.rpeMax) out.rpe = rule.rpeMax;
    return out;
  });
}

export function validRule(rule: ProgressionRule): string | null {
  if (!(rule.step > 0) || rule.step > (rule.kind === 'load' ? 100 : 10))
    return 'Enter a step above 0.';
  if (rule.kind === 'reps') {
    if (
      !Number.isInteger(rule.step) ||
      !Number.isInteger(rule.maxReps) ||
      rule.maxReps < 1 ||
      rule.maxReps > 100
    ) {
      return 'Enter whole reps.';
    }
    if (!(rule.loadStep >= 0) || rule.loadStep > 100) return 'Enter the load step.';
  }
  if (
    rule.rpeMax !== undefined &&
    (rule.rpeMax < 1 || rule.rpeMax > 10 || !Number.isInteger(rule.rpeMax * 2))
  ) {
    return 'RPE is 1 to 10, in halves.';
  }
  return null;
}
