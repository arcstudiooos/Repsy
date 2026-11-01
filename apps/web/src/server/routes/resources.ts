import { z } from 'zod';
import { archiveResource, createResource, listResources } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/resources` (PRD G5): coaches see all; a client sees what is shared with them. */
export const resourcesListRoute: RouteDef<undefined, true> = {
  can: 'session:read',
  handler: ({ actor, tenant }) => tenant((tx) => listResources(tx, actor)),
};

const createSchema = z.object({
  title: z.string().max(500),
  url: z.string().max(2000).optional(),
  body: z.string().max(8000).optional(),
  audience: z.string().max(20),
  tagId: z.string().max(64).optional(),
  clientId: z.string().max(64).optional(),
});

export const resourcesPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:update',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createResource(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const resourceDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => archiveResource(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};
