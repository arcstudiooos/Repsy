import { z } from 'zod';
import {
  completeSession,
  finishBodySchema,
  getSessionDetail,
  listSessions,
  skipSession,
  startSession,
  upsertSetLogs,
} from '@kinetic/core';
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

/** `GET /api/v1/sessions/:id`: the logging screen's data. A client reaches only their own sessions (404 otherwise). */
export const sessionGetRoute: RouteDef<undefined, true> = {
  can: 'session:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getSessionDetail(tx, actor, params.id ?? '')),
};

/** `POST /api/v1/sessions/:id/start`: locks the workout version (D-002 #6). Idempotent. */
export const sessionStartRoute: RouteDef<undefined, true> = {
  can: 'session:log',
  handler: ({ actor, params, requestId, tenant }) =>
    tenant((tx) => startSession(tx, actor, params.id ?? '', { requestId })),
};

// Items are validated in core (setLogInputSchema), which reports them under fieldError `items`.
const logsSchema = z.object({ items: z.array(z.unknown()).min(1).max(100) });

/** `POST /api/v1/sessions/:id/logs`: per-set upserts (D-004 #7). Idempotent per (exercise, set index). */
export const sessionLogsRoute: RouteDef<typeof logsSchema, true> = {
  can: 'session:log',
  input: logsSchema,
  // A set saves on every field blur: allow bursts, not floods (per user).
  rateLimit: { capacity: 120, refillPerSecond: 2 },
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => upsertSetLogs(tx, actor, params.id ?? '', input.items, { requestId })),
};

/** `POST /api/v1/sessions/:id/complete`: idempotent per session (Review Focus #2). */
export const sessionCompleteRoute: RouteDef<typeof finishBodySchema, true> = {
  can: 'session:log',
  input: finishBodySchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => completeSession(tx, actor, params.id ?? '', input, { requestId })),
};

/** `POST /api/v1/sessions/:id/skip`: idempotent per session. */
export const sessionSkipRoute: RouteDef<typeof finishBodySchema, true> = {
  can: 'session:log',
  input: finishBodySchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => skipSession(tx, actor, params.id ?? '', input, { requestId })),
};
