import { z } from 'zod';

/** True when `v` has at most `dp` decimal places (float-safe for these ranges). */
const maxDecimals = (v: number, dp: number): boolean => {
  const scaled = v * 10 ** dp;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Writes this far ahead of the server clock are rejected: a skewed device must not pin a set forever. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MAX_SETS = 20;
export const COMMENT_MAX = 1000;

/**
 * One set as the device sends it (PRD §9.1, D-004 #7). Values are optional and nullable (a cleared field is null);
 * weight is in kg (the UI converts at the edge). `clientUpdatedAt` orders writes from several devices.
 */
export const setLogInputSchema = z.strictObject({
  workoutVersionExerciseId: z.uuid(),
  setIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_SETS - 1),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  weightKg: z
    .number()
    .min(0)
    .max(2000)
    .refine((v) => maxDecimals(v, 3), 'Use at most 3 decimal places.')
    .transform(round3)
    .nullable()
    .optional(),
  rpe: z
    .number()
    .min(1)
    .max(10)
    .refine((v) => Number.isInteger(v * 2), 'Use steps of 0.5.')
    .nullable()
    .optional(),
  durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  distanceM: z
    .number()
    .min(0)
    .max(100000)
    .refine((v) => maxDecimals(v, 3), 'Use at most 3 decimal places.')
    .transform(round3)
    .nullable()
    .optional(),
  clientUpdatedAt: z.iso.datetime({ offset: true }),
  clientMutationId: z.uuid(),
});

export const logsBodySchema = z.object({
  items: z.array(setLogInputSchema).min(1).max(100),
});

export const finishBodySchema = z.object({
  idempotencyKey: z.uuid(),
  comment: z.string().max(COMMENT_MAX).optional(),
});

export type SetLogInput = z.input<typeof setLogInputSchema>;
export type ParsedSetLog = z.output<typeof setLogInputSchema>;
