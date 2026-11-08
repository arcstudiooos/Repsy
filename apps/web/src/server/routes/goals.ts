import { z } from 'zod';
import { createGoal, listGoals, setGoalStatus } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/goals` (PRD B18, E9): goals with progress. Coaches and the client themselves. */
export const goalsListRoute: RouteDef<undefined, true> = {
  can: 'metric:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => listGoals(tx, actor, params.id ?? '')),
};

const createSchema = z.object({
  kind: z.string().max(20),
  title: z.string().max(500).optional(),
  metric: z.string().max(40).optional(),
  exerciseId: z.string().max(64).optional(),
  exerciseMeasure: z.string().max(20).optional(),
  habitId: z.string().max(64).optional(),
  targetValue: z.number(),
  startValue: z.number().nullable().optional(),
  targetDate: z.string().max(10),
});

/** `POST /api/v1/clients/:id/goals`: coaches only. Values in canonical units (kg, cm, %). */
export const goalsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:update',
  input: createSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => createGoal(tx, actor, params.id ?? '', input, { requestId })),
      {
        status: 201,
      },
    ),
};

const statusSchema = z.object({ status: z.enum(['active', 'archived']) });

/** `PATCH /api/v1/goals/:id`: archive or restore. */
export const goalPatchRoute: RouteDef<typeof statusSchema, true> = {
  can: 'client:update',
  input: statusSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setGoalStatus(tx, actor, params.id ?? '', input.status, { requestId })),
};
