import { z } from 'zod';
import { createFollowup, listFlags, updateFlag, type FlagAction } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Filters and rules are checked by core (fieldErrors `filter` / `rule`).
const listSchema = z.object({
  filter: z.enum(['needs_attention', 'snoozed', 'closed']).optional(),
  rule: z.string().max(40).optional(),
  clientId: z.string().max(64).optional(),
});

/** `GET /api/v1/review-flags`: the review queue. */
export const reviewFlagsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'review:read',
  input: listSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => listFlags(tx, actor, input)),
};

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve'), reason: z.string().max(1000) }),
  z.object({ action: z.literal('dismiss'), reason: z.string().max(1000) }),
  z.object({
    action: z.literal('snooze'),
    days: z.number().int().optional(),
    until: z.string().max(20).optional(),
  }),
  z.object({ action: z.literal('reopen') }),
]);

/** `PATCH /api/v1/review-flags/:id`: resolve / dismiss (reason required), snooze, reopen. */
export const reviewFlagPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'review:update',
  input: patchSchema,
  handler: async ({ actor, input, params, requestId, tenant, track }) => {
    const flag = await tenant((tx) =>
      updateFlag(tx, actor, params.id ?? '', input as FlagAction, { requestId }),
    );
    if (input.action === 'resolve' || input.action === 'dismiss') {
      track('review_flag_resolved', { rule_key: flag.ruleKey, action: input.action });
    }
    return flag;
  },
};

const followupSchema = z.object({
  clientId: z.string().max(64),
  title: z.string().max(1000),
  dueLocalDate: z.string().max(20).nullable().optional(),
});

/** `POST /api/v1/review-flags`: a coach follow-up for a client. */
export const reviewFlagPostRoute: RouteDef<typeof followupSchema, true> = {
  can: 'review:update',
  input: followupSchema,
  handler: async ({ actor, input, requestId, tenant, track }) => {
    const flag = await tenant((tx) => createFollowup(tx, actor, input, { requestId }));
    track('review_flag_opened', { rule_key: 'coach_followup' });
    return new ApiResult(flag, { status: 201 });
  },
};
