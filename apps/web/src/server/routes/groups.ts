import { z } from 'zod';
import {
  archiveGroup,
  commentOnPost,
  dismissGroupReport,
  moderateGroupItem,
  muteMember,
  postToGroup,
  reactToPost,
  reportGroupItem,
  saveGroup,
  setGroupMembers,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

const groupSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
});

/** `POST /api/v1/groups` (PRD H7, H8). */
export const groupsPostRoute: RouteDef<typeof groupSchema, true> = {
  can: 'client:update',
  input: groupSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveGroup(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const groupPutRoute: RouteDef<typeof groupSchema, true> = {
  can: 'client:update',
  input: groupSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveGroup(tx, actor, { ...input, id: params.id }, { requestId })),
};

export const groupDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveGroup(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const membersSchema = z.object({ clientIds: z.array(z.string().max(64)).max(1000) });

export const groupMembersPutRoute: RouteDef<typeof membersSchema, true> = {
  can: 'client:update',
  input: membersSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => setGroupMembers(tx, actor, params.id ?? '', input.clientIds, { requestId })),
};

const postSchema = z.object({ kind: z.string().max(10), body: z.string().max(8000) });

/** `POST /api/v1/groups/:id/posts`: a chat message or a feed post. */
export const groupPostRoute: RouteDef<typeof postSchema, true> = {
  can: 'message:send',
  input: postSchema,
  rateLimit: { capacity: 30, refillPerSecond: 30 / 600 },
  handler: async ({ actor, input, params, tenant }) =>
    new ApiResult(await tenant((tx) => postToGroup(tx, actor, params.id ?? '', input)), {
      status: 201,
    }),
};

const commentSchema = z.object({ body: z.string().max(4000) });

export const groupCommentRoute: RouteDef<typeof commentSchema, true> = {
  can: 'message:send',
  input: commentSchema,
  rateLimit: { capacity: 30, refillPerSecond: 30 / 600 },
  handler: async ({ actor, input, params, tenant }) =>
    new ApiResult(await tenant((tx) => commentOnPost(tx, actor, params.id ?? '', input)), {
      status: 201,
    }),
};

const reactSchema = z.object({ kind: z.string().max(10), on: z.boolean() });

export const groupReactRoute: RouteDef<typeof reactSchema, true> = {
  can: 'message:send',
  input: reactSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) => reactToPost(tx, actor, params.id ?? '', input));
    return { on: input.on };
  },
};

const reportSchema = z.object({
  postId: z.string().max(64).optional(),
  commentId: z.string().max(64).optional(),
  reason: z.string().max(1000).optional(),
});

/** `POST /api/v1/group-reports`: report a post or comment to the coaches. */
export const groupReportRoute: RouteDef<typeof reportSchema, true> = {
  can: 'message:send',
  input: reportSchema,
  rateLimit: { capacity: 20, refillPerSecond: 20 / 3600 },
  handler: async ({ actor, input, tenant }) => {
    await tenant((tx) => reportGroupItem(tx, actor, input));
    return new ApiResult({ reported: true }, { status: 201 });
  },
};

export const groupReportDismissRoute: RouteDef<undefined, true> = {
  can: 'review:update',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => dismissGroupReport(tx, actor, params.id ?? ''));
    return new ApiResult(null, { status: 204 });
  },
};

const moderateSchema = z.object({
  postId: z.string().max(64).optional(),
  commentId: z.string().max(64).optional(),
  hidden: z.boolean(),
});

/** `PUT /api/v1/group-moderation`: a coach hides or restores a post or comment. */
export const groupModerateRoute: RouteDef<typeof moderateSchema, true> = {
  can: 'review:update',
  input: moderateSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    await tenant((tx) => moderateGroupItem(tx, actor, input, { requestId }));
    return { hidden: input.hidden };
  },
};

const muteSchema = z.object({ on: z.boolean() });

export const groupMuteRoute: RouteDef<typeof muteSchema, true> = {
  can: 'message:send',
  input: muteSchema,
  handler: async ({ actor, input, params, tenant }) => {
    await tenant((tx) => muteMember(tx, actor, params.id ?? '', input.on));
    return { on: input.on };
  },
};
