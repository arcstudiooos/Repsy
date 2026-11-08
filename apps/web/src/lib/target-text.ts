import type { SetTarget } from '@repsy/core';

/** "5:30 /km" from seconds per kilometre. */
export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/** Reps as written: "8" or a range "8-10" (PRD C7). */
export function repsText(s: Pick<SetTarget, 'reps' | 'repsMax'>): string | null {
  if (s.reps === undefined) return null;
  return s.repsMax !== undefined && s.repsMax > s.reps ? `${s.reps}-${s.repsMax}` : String(s.reps);
}

/** The PRD C7 targets beyond reps and load, in reading order: %1RM, RIR, pace, heart-rate zone. */
export function extraTargets(s: SetTarget): string[] {
  const out: string[] = [];
  if (s.percent1rm !== undefined) out.push(`${s.percent1rm}% 1RM`);
  if (s.rir !== undefined) out.push(`RIR ${s.rir}`);
  if (s.paceSecPerKm !== undefined) out.push(formatPace(s.paceSecPerKm));
  if (s.hrZone !== undefined) out.push(`Zone ${s.hrZone}`);
  return out;
}
