import { z } from 'zod';
import { withSystem } from '@repsy/db';
import {
  deletePushSubscription,
  DomainError,
  hasPushSubscription,
  isPushServiceEndpoint,
  releaseEndpoint,
  savePushSubscription,
  vapidKeys,
} from '@repsy/core';
import type { RouteDef } from '../api';

const endpointQuery = z.object({ endpoint: z.string().max(1000).optional() });

/**
 * `GET /api/v1/push?endpoint=`: the VAPID public key (null while push is off, PRD H11) and whether this device's
 * subscription is on file for the caller.
 */
export const pushGetRoute: RouteDef<typeof endpointQuery, true> = {
  input: endpointQuery,
  handler: async ({ actor, input, tenant }) => {
    const keys = vapidKeys();
    const subscribed =
      keys && input.endpoint
        ? await tenant((tx) => hasPushSubscription(tx, actor, input.endpoint!))
        : false;
    return { publicKey: keys?.publicKey ?? null, subscribed };
  },
};

const subscriptionSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

/** `POST /api/v1/push/subscriptions`: notifications on this device for the caller. */
export const pushSubscribeRoute: RouteDef<typeof subscriptionSchema, true> = {
  input: subscriptionSchema,
  rateLimit: { capacity: 10, refillPerSecond: 10 / 3600 },
  handler: async ({ actor, input, tenant }) => {
    // Checked before `releaseEndpoint` touches another user's row: only real push-service endpoints are accepted.
    if (!isPushServiceEndpoint(input.endpoint)) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        subscription: ['Invalid subscription.'],
      });
    }
    await withSystem((tx) => releaseEndpoint(tx, input.endpoint, actor.userId));
    await tenant((tx) => savePushSubscription(tx, actor, input));
    return { subscribed: true };
  },
};

const unsubscribeSchema = z.object({ endpoint: z.string().max(1000) });

/** `POST /api/v1/push/unsubscribe`: no more notifications on this device. */
export const pushUnsubscribeRoute: RouteDef<typeof unsubscribeSchema, true> = {
  input: unsubscribeSchema,
  handler: async ({ actor, input, tenant }) => {
    await tenant((tx) => deletePushSubscription(tx, actor, input.endpoint));
    return { subscribed: false };
  },
};
