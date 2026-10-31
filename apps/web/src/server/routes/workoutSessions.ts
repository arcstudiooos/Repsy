import { z } from 'zod';
import {
  completeSession,
  finishBodySchema,
  getSessionDetail,
  listSessions,
  reviseSetLogs,
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
  handler: async ({ actor, params, requestId, tenant, track, clientHash }) => {
    const t0 = Date.now();
    const detail = await tenant((tx) => startSession(tx, actor, params.id ?? '', { requestId }));
    // Replays return the stored start: only a start made by this request is an event.
    if (madeNow(detail.session.startedAt, t0)) {
      track('workout_started', {
        client_id_hash: clientHash(detail.client.id),
        logged_by_coach: actor.role !== 'client',
      });
    }
    return detail;
  },
};

/** True when `iso` (a timestamp the request may have written) is not older than the request. */
// Written by this process during the request (core stamps `new Date()`), so a replay is always older than t0.
const madeNow = (iso: string | null, t0: number) => iso !== null && Date.parse(iso) >= t0;

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

// Items and the reason are validated in core (fieldErrors `items` and `reason`).
const reviseSchema = z.object({
  items: z.array(z.unknown()).min(1).max(100),
  reason: z.unknown().optional(),
});

/**
 * `PATCH /api/v1/sessions/:id/logs`: edits a finished workout's sets (S3-4). The client within 24h of finishing
 * (else 403 `EDIT_WINDOW_CLOSED`), a coach at any time with a reason (else 422 `reason`). Each change is a revision.
 */
export const sessionLogsReviseRoute: RouteDef<typeof reviseSchema, true> = {
  can: 'session:log',
  input: reviseSchema,
  rateLimit: { capacity: 120, refillPerSecond: 2 },
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) =>
      reviseSetLogs(
        tx,
        actor,
        params.id ?? '',
        { items: input.items, reason: input.reason },
        { requestId },
      ),
    ),
};

/** `POST /api/v1/sessions/:id/complete`: idempotent per session (Review Focus #2). */
export const sessionCompleteRoute: RouteDef<typeof finishBodySchema, true> = {
  can: 'session:log',
  input: finishBodySchema,
  handler: async ({ actor, input, params, requestId, tenant, track, clientHash }) => {
    const t0 = Date.now();
    const detail = await tenant((tx) =>
      completeSession(tx, actor, params.id ?? '', input, { requestId }),
    );
    if (madeNow(detail.session.completedAt, t0)) {
      track('workout_completed', {
        client_id_hash: clientHash(detail.client.id),
        logged_by_coach: detail.session.loggedByCoach,
        set_count: detail.logs.length,
      });
    }
    return detail;
  },
};

/** `POST /api/v1/sessions/:id/skip`: idempotent per session. */
export const sessionSkipRoute: RouteDef<typeof finishBodySchema, true> = {
  can: 'session:log',
  input: finishBodySchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => skipSession(tx, actor, params.id ?? '', input, { requestId })),
};
