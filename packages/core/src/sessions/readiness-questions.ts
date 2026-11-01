/** PRD D17: the readiness check before Start. Pure: safe in the browser. Every answer is 1-5 with 5 the best. */
export const READINESS_QUESTIONS = [
  { key: 'sleep', label: 'Sleep', low: 'Poor', high: 'Great' },
  { key: 'energy', label: 'Energy', low: 'Drained', high: 'Full' },
  { key: 'soreness', label: 'Soreness', low: 'Very sore', high: 'Fresh' },
  { key: 'stress', label: 'Stress', low: 'Very stressed', high: 'Calm' },
  { key: 'mood', label: 'Mood', low: 'Low', high: 'Great' },
] as const;
export type ReadinessKey = (typeof READINESS_QUESTIONS)[number]['key'];
export type ReadinessAnswers = Record<ReadinessKey, number>;

/** 0 (every answer 1) to 100 (every answer 5). */
export function readinessScore(a: ReadinessAnswers): number {
  const sum = READINESS_QUESTIONS.reduce((s, q) => s + a[q.key], 0);
  return Math.round(((sum - READINESS_QUESTIONS.length) / (4 * READINESS_QUESTIONS.length)) * 100);
}
