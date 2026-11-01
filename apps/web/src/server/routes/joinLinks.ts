import { z } from 'zod';
import { createJoinLink, listJoinLinks, revokeJoinLink } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/join-links` (PRD B3): this workspace's sign-up links. */
export const joinLinksListRoute: RouteDef<undefined, true> = {
  can: 'client:create',
  handler: ({ actor, tenant }) => tenant((tx) => listJoinLinks(tx, actor)),
};

const createSchema = z.object({ maxUses: z.number().int() });

/** `POST /api/v1/join-links`: a new link; its token is in this response only. */
export const joinLinksPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:create',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createJoinLink(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `DELETE /api/v1/join-links/:id`: revoke. */
export const joinLinkDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:create',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => revokeJoinLink(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};
