import { z } from 'zod';
// NOTE (slice merge): see apps/web/src/server/routes/scheduling.ts — the
// parent adds these names to packages/core/src/index.ts first.
import { getLapseAccess, recordSubscriptionLapse } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/lapse` (PRD M12): this workspace's lapse status for the acting user. */
export const lapseGetRoute: RouteDef<undefined, true> = {
  can: 'session:read',
  handler: ({ actor, tenant }) => tenant((tx) => getLapseAccess(tx, actor)),
};

const lapseSchema = z.object({
  reason: z.string().max(120).nullable().optional(),
  lapsedAt: z.string().max(40).nullable().optional(),
});

/**
 * `POST /api/v1/lapse` (PRD M12): records a lapse. In production this is
 * called by the billing slice when a subscription lapses, not by hand.
 */
export const lapsePostRoute: RouteDef<typeof lapseSchema, true> = {
  can: 'settings:org:update',
  input: lapseSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => recordSubscriptionLapse(tx, actor, input)), {
      status: 201,
    }),
};
