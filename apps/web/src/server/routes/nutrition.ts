import { z } from 'zod';
import { getNutrition, logNutrition, setNutritionTarget } from '@kinetic/core';
import { type RouteDef } from '../api';

const macros = {
  calories: z.number().nullable().optional(),
  proteinG: z.number().nullable().optional(),
  carbsG: z.number().nullable().optional(),
  fatG: z.number().nullable().optional(),
};

/** `GET /api/v1/clients/:id/nutrition`: target, recent days and adherence (PRD G6/G7). */
export const nutritionGetRoute: RouteDef<undefined, true> = {
  can: 'nutrition:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => getNutrition(tx, actor, params.id ?? '')),
};

const targetSchema = z.object({ ...macros, effectiveFrom: z.string().max(10).optional() });

/** `PUT /api/v1/clients/:id/nutrition/target`: a coach sets daily targets from a date on. */
export const nutritionTargetRoute: RouteDef<typeof targetSchema, true> = {
  can: 'nutrition:manage',
  input: targetSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setNutritionTarget(tx, actor, params.id ?? '', input, { requestId })),
};

const logSchema = z.object({ ...macros, localDate: z.string().max(10).optional() });

/** `PUT /api/v1/clients/:id/nutrition/log`: a day's totals (replaces that day). */
export const nutritionLogRoute: RouteDef<typeof logSchema, true> = {
  can: 'nutrition:log',
  input: logSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => logNutrition(tx, actor, params.id ?? '', input)),
};
