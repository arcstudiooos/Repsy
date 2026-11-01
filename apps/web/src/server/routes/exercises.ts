import { z } from 'zod';
import {
  createExercise,
  listAlternatives,
  searchExercises,
  setAlternatives,
  setExerciseDemo,
  TRACKING_TYPES,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const listSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  muscleGroup: z.string().trim().min(1).max(40).optional(),
  equipment: z.string().trim().min(1).max(40).optional(),
  trackingType: z.enum(TRACKING_TYPES).optional(),
  cursor: z.string().min(1).max(500).optional(),
});

export const exercisesListRoute: RouteDef<typeof listSchema, true> = {
  can: 'exercise:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) => searchExercises(tx, actor, input));
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  equipment: z.string().trim().min(1).max(40),
  muscleGroup: z.string().trim().min(1).max(40),
  movementType: z.string().trim().min(1).max(40),
  trackingType: z.enum(TRACKING_TYPES),
  instructions: z.string().max(2000).optional(),
  mediaUrl: z.string().max(500).nullable().optional(),
  secondaryMuscles: z.array(z.string().max(100)).max(10).optional(),
  unilateral: z.boolean().optional(),
  difficulty: z.string().max(20).nullable().optional(),
  cues: z.array(z.string().max(300)).max(12).optional(),
});

export const exercisesPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'exercise:create',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    const created = await tenant((tx) => createExercise(tx, actor, input, { requestId }));
    return new ApiResult(created, { status: 201 });
  },
};

/** `GET /api/v1/exercises/:id/alternatives` (PRD C4). */
export const exerciseAlternativesGetRoute: RouteDef<undefined, true> = {
  can: 'exercise:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => listAlternatives(tx, actor, params.id ?? '')),
};

const alternativesSchema = z.object({ alternativeIds: z.array(z.string().max(64)).max(10) });

/** `PUT /api/v1/exercises/:id/alternatives`: replace the list (up to 5, same tracking type). */
export const exerciseAlternativesPutRoute: RouteDef<typeof alternativesSchema, true> = {
  can: 'exercise:create',
  input: alternativesSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) =>
      setAlternatives(tx, actor, params.id ?? '', input.alternativeIds, { requestId }),
    ),
};

const demoSchema = z.object({ mediaId: z.string().max(64).nullable() });

/** `PUT /api/v1/exercises/:id/demo` (PRD C2): attach an uploaded MP4 demo, or `null` to remove it. */
export const exerciseDemoPutRoute: RouteDef<typeof demoSchema, true> = {
  can: 'exercise:create',
  input: demoSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setExerciseDemo(tx, actor, params.id ?? '', input.mediaId, { requestId })),
};
