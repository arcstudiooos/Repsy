import { z } from 'zod';
import { getClientContext, setNotePinned, updateClientContext } from '@repsy/core';
import { type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/context`: the client context card (PRD B7), coaches only. */
export const contextGetRoute: RouteDef<undefined, true> = {
  can: 'note:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getClientContext(tx, actor, params.id ?? '')),
};

const patchSchema = z.object({
  goals: z.string().max(5000).nullable().optional(),
  motivation: z.string().max(5000).nullable().optional(),
  scheduleNotes: z.string().max(5000).nullable().optional(),
  equipmentNotes: z.string().max(5000).nullable().optional(),
  preferences: z.string().max(5000).nullable().optional(),
  trainingLocation: z.string().max(40).nullable().optional(),
  equipment: z.array(z.string().max(40)).max(20).optional(),
});

/** `PATCH /api/v1/clients/:id/context`: update the fields given (core validates lengths). */
export const contextPatchRoute: RouteDef<typeof patchSchema, true> = {
  can: 'client:update',
  input: patchSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => updateClientContext(tx, actor, params.id ?? '', input, { requestId })),
};

const pinSchema = z.object({ pinned: z.boolean() });

/** `PUT /api/v1/notes/:id/pin`: pin a note to the context card, or unpin it. */
export const notePinRoute: RouteDef<typeof pinSchema, true> = {
  can: 'note:write',
  input: pinSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => setNotePinned(tx, actor, params.id ?? '', input.pinned)),
};
