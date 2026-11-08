import { z } from 'zod';
import {
  addTagToClients,
  BULK_MAX_CLIENTS,
  createTag,
  deleteTag,
  listTags,
  setClientTags,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/tags`: the organization's client tags with counts (PRD B4). */
export const tagsListRoute: RouteDef<undefined, true> = {
  can: 'client:read',
  handler: ({ actor, tenant }) => tenant((tx) => listTags(tx, actor)),
};

const createSchema = z.object({ name: z.string().max(200), color: z.string().max(20).optional() });

/** `POST /api/v1/tags`. */
export const tagsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:update',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createTag(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

/** `DELETE /api/v1/tags/:id`: removes the tag from every client. */
export const tagDeleteRoute: RouteDef<undefined, true> = {
  can: 'client:update',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => deleteTag(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const clientTagsSchema = z.object({ tagIds: z.array(z.string().max(64)).max(50) });

/** `PUT /api/v1/clients/:id/tags`: replace the client's tags. */
export const clientTagsPutRoute: RouteDef<typeof clientTagsSchema, true> = {
  can: 'client:update',
  input: clientTagsSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => setClientTags(tx, actor, params.id ?? '', input.tagIds)),
};

const bulkTagSchema = z.object({
  clientIds: z.array(z.string().min(1).max(64)).min(1).max(BULK_MAX_CLIENTS),
});

/** `POST /api/v1/tags/:id/clients` (PRD B5): adds the tag to many clients at once. */
export const tagClientsPostRoute: RouteDef<typeof bulkTagSchema, true> = {
  can: 'client:update',
  input: bulkTagSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => addTagToClients(tx, actor, params.id ?? '', input.clientIds, { requestId })),
};
