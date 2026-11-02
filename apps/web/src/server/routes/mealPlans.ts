import { z } from 'zod';
import {
  archiveMealPlan,
  archiveRecipe,
  saveMealPlan,
  saveRecipe,
  setClientMealPlan,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

const macro = z.union([z.number(), z.null()]).optional();
const recipeSchema = z.object({
  title: z.string().max(500),
  servings: z.number().optional(),
  ingredients: z
    .array(
      z.object({
        name: z.string().max(200),
        amount: z.union([z.number(), z.null()]).optional(),
        unit: z.string().max(50).optional(),
      }),
    )
    .max(100)
    .optional(),
  steps: z.string().max(20_000).optional(),
  calories: macro,
  proteinG: macro,
  carbsG: macro,
  fatG: macro,
  photoMediaId: z.string().max(64).nullable().optional(),
});

/** `POST /api/v1/recipes` (PRD G9). */
export const recipesPostRoute: RouteDef<typeof recipeSchema, true> = {
  can: 'nutrition:manage',
  input: recipeSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveRecipe(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const recipePutRoute: RouteDef<typeof recipeSchema, true> = {
  can: 'nutrition:manage',
  input: recipeSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveRecipe(tx, actor, { ...input, id: params.id }, { requestId })),
};

export const recipeDeleteRoute: RouteDef<undefined, true> = {
  can: 'nutrition:manage',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveRecipe(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const option = z.object({
  recipeId: z.string().max(64).optional(),
  servings: z.number().optional(),
  text: z.string().max(500).optional(),
  calories: macro,
  proteinG: macro,
  carbsG: macro,
  fatG: macro,
});
const planSchema = z.object({
  title: z.string().max(500),
  notes: z.string().max(8000).optional(),
  pdfMediaId: z.string().max(64).nullable().optional(),
  days: z
    .array(
      z.object({
        name: z.string().max(100).optional(),
        meals: z
          .array(z.object({ name: z.string().max(100), options: z.array(option).max(10) }))
          .max(20),
      }),
    )
    .max(30),
});

/** `POST /api/v1/meal-plans` (PRD G8). */
export const mealPlansPostRoute: RouteDef<typeof planSchema, true> = {
  can: 'nutrition:manage',
  input: planSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveMealPlan(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const mealPlanPutRoute: RouteDef<typeof planSchema, true> = {
  can: 'nutrition:manage',
  input: planSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveMealPlan(tx, actor, { ...input, id: params.id }, { requestId })),
};

export const mealPlanDeleteRoute: RouteDef<undefined, true> = {
  can: 'nutrition:manage',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveMealPlan(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const assignSchema = z.object({ mealPlanId: z.string().max(64).nullable() });

/** `PUT /api/v1/clients/:id/meal-plan`: give the client a plan (or none). */
export const clientMealPlanPutRoute: RouteDef<typeof assignSchema, true> = {
  can: 'nutrition:manage',
  input: assignSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    await tenant((tx) =>
      setClientMealPlan(tx, actor, params.id ?? '', input.mealPlanId, { requestId }),
    );
    return { mealPlanId: input.mealPlanId };
  },
};
