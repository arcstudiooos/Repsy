import { issueInvite, revokeInvite } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** 10 issues/resends per hour per user. */
const ISSUE_LIMIT = { capacity: 10, refillPerSecond: 10 / 3600 };

export const invitePostRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  rateLimit: ISSUE_LIMIT,
  handler: async ({ actor, params, requestId, tenant }) => {
    const result = await tenant((tx) =>
      issueInvite(tx, actor, params.id ?? '', new Date(), requestId),
    );
    return new ApiResult(
      { inviteId: result.inviteId, expiresAt: result.expiresAt.toISOString() },
      { status: 201 },
    );
  },
};

export const inviteDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: ({ actor, params, requestId, tenant }) =>
    tenant((tx) => revokeInvite(tx, actor, params.id ?? '', requestId)),
};
