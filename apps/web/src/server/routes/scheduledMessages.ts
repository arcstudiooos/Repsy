import { z } from 'zod';
import { cancelScheduledMessage, listScheduledMessages, scheduleMessage } from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

/** `GET /api/v1/clients/:id/scheduled-messages` (PRD H5): messages waiting to go out to this client. */
export const scheduledListRoute: RouteDef<undefined, true> = {
  can: 'message:send',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => listScheduledMessages(tx, actor, params.id ?? '')),
};

const scheduleSchema = z.object({
  body: z.string().max(5000),
  localDate: z.string().max(10),
  localTime: z.string().max(5),
});

/** `POST /api/v1/clients/:id/scheduled-messages`: send `body` at `localDate` `localTime`, the client's time. */
export const schedulePostRoute: RouteDef<typeof scheduleSchema, true> = {
  can: 'message:send',
  input: scheduleSchema,
  rateLimit: { capacity: 30, refillPerSecond: 30 / 3600 },
  handler: async ({ actor, input, params, requestId, tenant }) =>
    new ApiResult(
      await tenant((tx) => scheduleMessage(tx, actor, params.id ?? '', input, { requestId })),
      { status: 201 },
    ),
};

/** `DELETE /api/v1/scheduled-messages/:id`: cancel before it is sent. */
export const scheduledDeleteRoute: RouteDef<undefined, true> = {
  can: 'message:send',
  handler: async ({ actor, params, requestId, tenant }) => {
    await tenant((tx) => cancelScheduledMessage(tx, actor, params.id, { requestId }));
    return { cancelled: true };
  },
};
