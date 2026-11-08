import { z } from 'zod';
import {
  broadcastMessage,
  getClientThread,
  getMyThread,
  listMessages,
  listThreads,
  sendMessage,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';
import { onMessageSent } from '../reviewHooks';

/** `GET /api/v1/threads`: the coach inbox, most recent first. */
export const threadsListRoute: RouteDef<undefined, true> = {
  can: 'message:read',
  handler: ({ actor, tenant }) => tenant((tx) => listThreads(tx, actor)),
};

/** `GET /api/v1/threads/me`: the acting client's thread (created on first open). */
export const threadMeRoute: RouteDef<undefined, true> = {
  can: 'message:read',
  handler: ({ actor, tenant }) => tenant((tx) => getMyThread(tx, actor)),
};

/** `GET /api/v1/clients/:id/thread`: a client's thread for the coach (created on first open). */
export const clientThreadRoute: RouteDef<undefined, true> = {
  can: 'message:read',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getClientThread(tx, actor, params.id ?? '')),
};

const listSchema = z.object({ cursor: z.string().min(1).max(500).optional() });

/** `GET /api/v1/threads/:id/messages`: newest first, 30 per page. The first page marks the thread read. */
export const messagesListRoute: RouteDef<typeof listSchema, true> = {
  can: 'message:read',
  input: listSchema,
  handler: async ({ actor, input, params, tenant }) => {
    const { items, nextCursor } = await tenant((tx) =>
      listMessages(tx, actor, params.id ?? '', input),
    );
    return new ApiResult(items, { meta: { nextCursor } });
  },
};

// The body is validated by core (fieldErrors `body`); never logged.
const sendSchema = z.object({
  body: z.string().max(10_000),
  clientMessageId: z.string().max(64).optional(),
  // PRD H3: validated against the thread's client by core.
  anchor: z.object({ type: z.string().max(16), id: z.string().max(64) }).optional(),
  // PRD H2: an uploaded file (purpose message) for this thread's client.
  attachmentMediaId: z.string().max(64).optional(),
});

/** `POST /api/v1/threads/:id/messages`. Idempotent on `clientMessageId`. */
export const messagesPostRoute: RouteDef<typeof sendSchema, true> = {
  can: 'message:send',
  input: sendSchema,
  rateLimit: { capacity: 30, refillPerSecond: 0.5 },
  handler: async ({ actor, input, params, requestId, tenant, track }) => {
    const t0 = Date.now();
    const message = await tenant((tx) =>
      sendMessage(tx, actor, params.id ?? '', input, { requestId, onSent: onMessageSent }),
    );
    // Coach messages only (§13), and not a retried send.
    if (actor.role !== 'client' && Date.parse(message.createdAt) >= t0) {
      track('coach_message_sent');
    }
    return new ApiResult(message, { status: 201 });
  },
};

const broadcastSchema = z.object({
  audience: z.string().max(64),
  clientIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  body: z.string().max(8000),
  idempotencyKey: z.string().max(64),
});

/** `POST /api/v1/messages/broadcast` (PRD H6): one message to everyone or a tag, as individual messages. */
export const broadcastRoute: RouteDef<typeof broadcastSchema, true> = {
  can: 'message:send',
  input: broadcastSchema,
  handler: ({ actor, input, requestId, tenant }) =>
    tenant((tx) => broadcastMessage(tx, actor, input, { requestId, onSent: onMessageSent })),
};
