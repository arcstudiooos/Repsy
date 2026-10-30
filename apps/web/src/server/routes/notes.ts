import { z } from 'zod';
import { createNote, deleteNote, getClientTimeline, listNotes, updateNote } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/notes`: private notes, coach/owner only. */
export const notesListRoute: RouteDef<undefined, true> = {
  can: 'note:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => listNotes(tx, actor, params.id ?? '')),
};

// The body is validated by core (fieldErrors `body`).
const bodySchema = z.object({ body: z.string().max(10_000) });

/** `POST /api/v1/clients/:id/notes`. */
export const notesPostRoute: RouteDef<typeof bodySchema, true> = {
  can: 'note:write',
  input: bodySchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => createNote(tx, actor, params.id ?? '', input, { requestId })),
      { status: 201 },
    ),
};

/** `PATCH /api/v1/notes/:id`: the author only. */
export const notePatchRoute: RouteDef<typeof bodySchema, true> = {
  can: 'note:write',
  input: bodySchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => updateNote(tx, actor, params.id ?? '', input, { requestId })),
};

/** `DELETE /api/v1/notes/:id`: the author only. */
export const noteDeleteRoute: RouteDef<undefined, true> = {
  can: 'note:write',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => deleteNote(tx, actor, params.id ?? '', { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

/** `GET /api/v1/clients/:id/timeline`: the client's history for the coach (includes notes). */
export const timelineRoute: RouteDef<undefined, true> = {
  can: 'note:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getClientTimeline(tx, actor, params.id ?? '')),
};
