import { z } from 'zod';
import { listMetrics, recordMetric } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/metrics`: body metrics (PRD E1). A client reaches only their own (core). */
export const metricsListRoute: RouteDef<undefined, true> = {
  can: 'metric:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => listMetrics(tx, actor, params.id ?? '')),
};

// Values and dates are validated by core (fieldErrors `metric`, `measuredOn`, `value`, `reason`).
const bodySchema = z.object({
  metric: z.string().max(40),
  measuredOn: z.string().max(10),
  value: z.number(),
  reason: z.string().max(2000).optional(),
});

/** `POST /api/v1/clients/:id/metrics`: record or change one day's value, in the client's units. */
export const metricsPostRoute: RouteDef<typeof bodySchema, true> = {
  can: 'metric:write',
  input: bodySchema,
  handler: async ({ actor, input, params, tenant }) =>
    new ApiResult(await tenant((tx) => recordMetric(tx, actor, params.id ?? '', input)), {
      status: 200,
    }),
};
