import { getReviewOverview, markReviewSeen } from '@kinetic/core';
import type { RouteDef } from '../api';

/** `GET /api/v1/review`: Sprint 2 review list (S2-4), read queries over the org's sessions. */
export const reviewGetRoute: RouteDef<undefined, true> = {
  can: 'review:read',
  handler: ({ actor, tenant }) => tenant((tx) => getReviewOverview(tx, actor)),
};

/** `POST /api/v1/review/seen`: marks every completion so far as seen for the acting coach. */
export const reviewSeenRoute: RouteDef<undefined, true> = {
  can: 'review:update',
  handler: ({ actor, requestId, tenant }) =>
    tenant((tx) => markReviewSeen(tx, actor, { requestId })),
};
