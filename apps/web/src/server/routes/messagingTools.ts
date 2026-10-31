import { z } from 'zod';
import {
  createSavedReply,
  deleteSavedReply,
  getReplyExpectations,
  getReviewRuleSettings,
  listSavedReplies,
  updateReplyExpectations,
  updateReviewRuleSettings,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/org/reply-expectations` (PRD H16): readable by coaches and clients. */
export const replyExpectationsGetRoute: RouteDef<undefined, true> = {
  can: 'message:read',
  handler: ({ actor, tenant }) => tenant((tx) => getReplyExpectations(tx, actor)),
};

const expectationsSchema = z.object({
  replyTargetHours: z.number().nullable().optional(),
  officeHours: z.string().max(1000).nullable().optional(),
});

/** `PUT /api/v1/org/reply-expectations`: owner only. */
export const replyExpectationsPutRoute: RouteDef<typeof expectationsSchema, true> = {
  can: 'settings:org:update',
  input: expectationsSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => updateReplyExpectations(tx, actor, input, { requestId })),
};

/** `GET /api/v1/saved-replies` (PRD H4): coaches only. */
export const savedRepliesListRoute: RouteDef<undefined, true> = {
  can: 'note:read',
  handler: ({ actor, tenant }) => tenant((tx) => listSavedReplies(tx, actor)),
};

const replySchema = z.object({ title: z.string().max(500), body: z.string().max(5000) });

export const savedRepliesPostRoute: RouteDef<typeof replySchema, true> = {
  can: 'note:write',
  input: replySchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => createSavedReply(tx, actor, input)), { status: 201 }),
};

export const savedReplyDeleteRoute: RouteDef<undefined, true> = {
  can: 'note:write',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => deleteSavedReply(tx, actor, params.id ?? ''));
    return new ApiResult(null, { status: 204 });
  },
};

/** `GET /api/v1/org/review-rules` (PRD I3): which opt-in review rules are on. */
export const reviewRulesGetRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) => tenant((tx) => getReviewRuleSettings(tx, actor)),
};

const reviewRulesSchema = z.object({
  enabled: z.array(z.string().max(40)).max(10),
  weightChangeBandPct: z.number().nullable().optional(),
  clientsCanMoveWorkouts: z.boolean().optional(),
});

/** `PUT /api/v1/org/review-rules`: owner only. */
export const reviewRulesPutRoute: RouteDef<typeof reviewRulesSchema, true> = {
  can: 'settings:org:update',
  input: reviewRulesSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => updateReviewRuleSettings(tx, actor, input)),
};
