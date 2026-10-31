import { z } from 'zod';
import { createHabit, listHabits, logHabit, setHabitStatus } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/habits`: habits and tasks (PRD G1-G3). A client reaches only their own (core). */
export const habitsListRoute: RouteDef<undefined, true> = {
  can: 'habit:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => listHabits(tx, actor, params.id ?? '')),
};

// Validated in depth by core (fieldErrors per field).
const createSchema = z.object({
  title: z.string().max(500),
  isTask: z.boolean().optional(),
  daysPerWeek: z.number().optional(),
  targetCount: z.number().nullable().optional(),
  unit: z.string().max(100).nullable().optional(),
  startDate: z.string().max(10).optional(),
  endDate: z.string().max(10).nullable().optional(),
  dueDate: z.string().max(10).optional(),
});

/** `POST /api/v1/clients/:id/habits`: a coach assigns a habit or task. */
export const habitsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'habit:manage',
  input: createSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => createHabit(tx, actor, params.id ?? '', input, { requestId })),
      { status: 201 },
    ),
};

const statusSchema = z.object({ status: z.enum(['active', 'archived']) });

/** `PUT /api/v1/habits/:id/status`: archive or restore (coach). */
export const habitStatusRoute: RouteDef<typeof statusSchema, true> = {
  can: 'habit:manage',
  input: statusSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setHabitStatus(tx, actor, params.id ?? '', input.status, { requestId })),
};

const logSchema = z.object({
  localDate: z.string().max(10).optional(),
  value: z.number().optional(),
  done: z.boolean().optional(),
});

/** `POST /api/v1/habits/:id/log`: tick or untick a day (habit) or mark a task done. */
export const habitLogRoute: RouteDef<typeof logSchema, true> = {
  can: 'habit:log',
  input: logSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => logHabit(tx, actor, params.id ?? '', input)),
};
