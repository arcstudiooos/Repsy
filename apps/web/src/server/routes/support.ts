import { z } from 'zod';
import { requestSupport } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

const supportSchema = z.object({ topic: z.string().max(20), message: z.string().max(6000) });

/** `POST /api/v1/support` (PRD M13): coaches and clients alike; the inbox is SUPPORT_EMAIL. */
export const supportPostRoute: RouteDef<typeof supportSchema, true> = {
  input: supportSchema,
  rateLimit: { capacity: 5, refillPerSecond: 5 / 3600 },
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) =>
        requestSupport(tx, actor, input, {
          to: process.env.SUPPORT_EMAIL || 'support@example.test',
          requestId,
        }),
      ),
      { status: 202 },
    ),
};
