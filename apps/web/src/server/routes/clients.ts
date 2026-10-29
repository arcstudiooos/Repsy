import { z } from 'zod';
import { appendAudit } from '@kinetic/db';
import { createClient, getClient, listClients, updateClient, type ClientView } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys (including any `organizationId`) are stripped by Zod and never read.
const listSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['invited', 'active', 'paused', 'archived']).optional(),
  cursor: z.string().min(1).max(500).optional(),
});

export const clientsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'client:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) => listClients(tx, actor, input));
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254),
  goals: z.string().max(2000).optional(),
});

export const clientsPostRoute: RouteDef<typeof createSchema, true> = {
  can: 'client:create',
  input: createSchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    const client = await tenant(async (tx) => {
      const created = await createClient(tx, actor, input);
      await appendAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        objectType: 'client',
        objectId: created.id,
        action: 'client.created',
        requestId,
      });
      return created;
    });
    return new ApiResult(client satisfies ClientView, { status: 201 });
  },
};

export const clientGetRoute: RouteDef<undefined, true> = {
  can: 'client:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => getClient(tx, actor, params.id ?? '')),
};

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  goals: z.string().max(2000).nullable().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const clientPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'client:update',
  input: patchSchema,
  handler: ({ actor, input, params, requestId, tenant }) => {
    const id = params.id ?? '';
    return tenant(async (tx) => {
      const updated = await updateClient(tx, actor, id, input);
      await appendAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        objectType: 'client',
        objectId: id,
        action: 'client.updated',
        requestId,
      });
      return updated;
    });
  },
};
