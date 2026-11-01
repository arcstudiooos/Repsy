import { z } from 'zod';

/** True when `v` has at most `dp` decimal places (float-safe for the ranges used here). */
/** Rounds to 3 decimals so float noise (0.30000000000000004) hashes the same as 0.3. */
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const maxDecimals = (v: number, dp: number): boolean => {
  const scaled = v * 10 ** dp;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

/** One prescribed set. Which fields are required depends on the exercise's trackingType (see commit.ts). */
export const setTargetSchema = z
  .strictObject({
    reps: z.number().int().min(0).max(1000).optional(),
    loadKg: z
      .number()
      .min(0)
      .max(2000)
      .refine((v) => maxDecimals(v, 3), 'Use at most 3 decimal places.')
      .transform(round3)
      .optional(),
    rpe: z
      .number()
      .min(1)
      .max(10)
      .refine((v) => Number.isInteger(v * 2), 'Use steps of 0.5.')
      .optional(),
    restSec: z.number().int().min(0).max(3600).optional(),
    tempo: z
      .string()
      .regex(/^[0-9X]{4}$/, 'Use four characters, each 0-9 or X.')
      .optional(),
    durationSec: z.number().int().min(1).max(86400).optional(),
    distanceM: z
      .number()
      .min(0)
      .max(100000)
      .refine((v) => maxDecimals(v, 3), 'Use at most 3 decimal places.')
      .transform(round3)
      .optional(),
    /** PRD C7: the top of a rep range ("8-10"); at least `reps`. */
    repsMax: z.number().int().min(1).max(1000).optional(),
    /** Reps in reserve. */
    rir: z.number().int().min(0).max(10).optional(),
    /** Load as a share of the client's 1RM. */
    percent1rm: z
      .number()
      .min(1)
      .max(100)
      .refine((v) => maxDecimals(v, 1), 'Use at most 1 decimal place.')
      .optional(),
    /** Seconds per kilometre, for timed or distance work. */
    paceSecPerKm: z.number().int().min(60).max(3600).optional(),
    /** Heart-rate zone 1-5. */
    hrZone: z.number().int().min(1).max(5).optional(),
  })
  .refine((s) => s.repsMax === undefined || s.reps === undefined || s.repsMax >= s.reps, {
    message: 'The top of the range must be at least the reps.',
    path: ['repsMax'],
  });

/** The sets prescribed for one exercise in one workout: 1 to 20. */
export const targetSchema = z.array(setTargetSchema).min(1).max(20);

export type SetTarget = z.infer<typeof setTargetSchema>;
export type WorkoutTargets = z.infer<typeof targetSchema>;
