import { z } from 'zod';
import { getReviewOverview, markReviewSeen } from '@repsy/core';
import type { RouteDef } from '../api';

/** `GET /api/v1/review`: Sprint 2 review list (S2-4), read queries over the org's sessions. */
export const reviewGetRoute: RouteDef<undefined, true> = {
  can: 'review:read',
  handler: ({ actor, tenant }) => tenant((tx) => getReviewOverview(tx, actor)),
};

const seenSchema = z.object({ through: z.iso.datetime({ offset: true }) });

/** `POST /api/v1/review/seen`: marks completions up to `through` (the list's `generatedAt`) as seen. */
export const reviewSeenRoute: RouteDef<typeof seenSchema, true> = {
  can: 'review:update',
  input: seenSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => markReviewSeen(tx, actor, input, { requestId })),
};
