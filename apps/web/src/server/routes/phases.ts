import { z } from 'zod';
import { addPhase, listPhases, removePhase, startPhase } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/phases` (PRD C17): the client's queued program phases. */
export const phasesListRoute: RouteDef<undefined, true> = {
  can: 'assignment:read',
  handler: ({ actor, params, tenant }) => tenant((tx) => listPhases(tx, actor, params.id ?? '')),
};

const phaseSchema = z.object({ templateProgramId: z.string().max(64), mode: z.string().max(10) });

/** `POST /api/v1/clients/:id/phases`: queue a template to run after the current program. */
export const phasesPostRoute: RouteDef<typeof phaseSchema, true> = {
  can: 'assignment:write',
  input: phaseSchema,
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => addPhase(tx, actor, params.id, input, { requestId })), {
      status: 201,
    }),
};

/** `DELETE /api/v1/phases/:id`: take it off the queue. */
export const phaseDeleteRoute: RouteDef<undefined, true> = {
  can: 'assignment:write',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => removePhase(tx, actor, params.id));
    return { removed: true };
  },
};

/** `POST /api/v1/phases/:id/start`: start it now (approve mode, PRD J7). */
export const phaseStartRoute: RouteDef<undefined, true> = {
  can: 'assignment:write',
  handler: ({ actor, params, requestId, tenant }) =>
    tenant((tx) => startPhase(tx, actor, params.id, { requestId })),
};
