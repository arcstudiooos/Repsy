import { z } from 'zod';
import { convertLead, updateLead, updatePublicPage } from '@kinetic/core';
import type { RouteDef } from '../api';

const leadSchema = z.object({
  status: z.string().max(20).optional(),
  notes: z.string().max(5000).optional(),
});

/** `PATCH /api/v1/leads/:id` (PRD B16): move a lead along the pipeline, or keep notes. */
export const leadPatchRoute: RouteDef<typeof leadSchema, true> = {
  can: 'client:update',
  input: leadSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => updateLead(tx, actor, params.id, input, { requestId })),
};

/** `POST /api/v1/leads/:id/convert`: make them a client and send the invite. */
export const leadConvertRoute: RouteDef<undefined, true> = {
  can: 'client:create',
  handler: ({ actor, params, requestId, tenant }) =>
    tenant((tx) => convertLead(tx, actor, params.id, { requestId })),
};

const pageSchema = z.object({
  slug: z.string().max(60),
  bio: z.string().max(5000).nullable().optional(),
  offers: z.string().max(5000).nullable().optional(),
  enabled: z.boolean(),
});

/** `PUT /api/v1/org/public-page` (PRD B15). */
export const publicPagePutRoute: RouteDef<typeof pageSchema, true> = {
  can: 'org:read',
  input: pageSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => updatePublicPage(tx, actor, input, { requestId })),
};
