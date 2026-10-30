import { z } from 'zod';
import { listSessions } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';

// Unknown keys are stripped. `clientId` is only read for coaches: core ignores it for a client actor.
const listSchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: z.string().min(1).max(500).optional(),
  clientId: z.string().min(1).max(64).optional(),
});

/** `GET /api/v1/sessions`: the acting client's own sessions, or (coach) one client's. */
export const sessionsListRoute: RouteDef<typeof listSchema, true> = {
  can: 'session:read',
  input: listSchema,
  handler: async ({ actor, input, tenant }) => {
    const { items, nextCursor } = await tenant((tx) => listSessions(tx, actor, input));
    return new ApiResult(items, { meta: { nextCursor } });
  },
};
