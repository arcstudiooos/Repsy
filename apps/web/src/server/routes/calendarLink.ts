import { hasCalendarFeed, revokeCalendarToken, rotateCalendarToken } from '@kinetic/core';
import type { RouteDef } from '../api';

const urlFor = (token: string) =>
  `${(process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')}/calendar/${token}.ics`;

/** `GET /api/v1/me/calendar-link` (PRD L7): whether the client has a feed link. */
export const calendarLinkGetRoute: RouteDef<undefined, true> = {
  handler: async ({ actor, tenant }) => ({
    active: await tenant((tx) => hasCalendarFeed(tx, actor)),
  }),
};

/** `POST`: a new link (the old one stops working). Shown once. */
export const calendarLinkPostRoute: RouteDef<undefined, true> = {
  rateLimit: { capacity: 10, refillPerSecond: 10 / 3600 },
  handler: async ({ actor, requestId, tenant }) => {
    const { token } = await tenant((tx) => rotateCalendarToken(tx, actor, { requestId }));
    return { url: urlFor(token) };
  },
};

/** `DELETE`: turn the feed off. */
export const calendarLinkDeleteRoute: RouteDef<undefined, true> = {
  handler: async ({ actor, tenant }) => {
    await tenant((tx) => revokeCalendarToken(tx, actor));
    return { active: false };
  },
};
