import { z } from 'zod';
import {
  coachBusyTimes,
  coachConnectionForSessionType,
  disconnectCalendar,
  DomainError,
  exchangeGoogleCode,
  getCalendarConnection,
  googleConsentUrl,
  googleOAuthConfig,
  revokeGoogleToken,
  saveGoogleConnection,
  signCalendarState,
  verifyCalendarState,
} from '@repsy/core';
import type { TenantTx } from '@repsy/db';
import { ApiResult, type RouteDef } from '../api';

/** PRD K10: Google Calendar connection for the signed-in staff user. */

const stateSecret = () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new DomainError('INTERNAL', 'Server is missing BETTER_AUTH_SECRET.');
  return secret;
};

const redirect = (path: string) =>
  new ApiResult({ redirect: path }, { status: 302, headers: { location: path } });

/** `GET /api/v1/calendar/connection`: the caller's connection, and whether Google is configured. */
export const calendarConnectionGetRoute: RouteDef<undefined, true> = {
  can: 'scheduling:manage',
  handler: async ({ actor, tenant }) => ({
    connection: await tenant((tx) => getCalendarConnection(tx, actor)),
    available: googleOAuthConfig() !== null,
  }),
};

/** `DELETE /api/v1/calendar/connection`: disconnect, and revoke the grant at Google. */
export const calendarConnectionDeleteRoute: RouteDef<undefined, true> = {
  can: 'scheduling:manage',
  handler: async ({ actor, tenant }) => {
    const { refreshToken } = await tenant((tx) => disconnectCalendar(tx, actor));
    if (refreshToken) await revokeGoogleToken(refreshToken);
    return { disconnected: true };
  },
};

/** `GET /api/v1/calendar/google/connect`: sends the browser to Google's consent screen. */
export const calendarGoogleConnectRoute: RouteDef<undefined, true> = {
  can: 'scheduling:manage',
  rateLimit: { capacity: 10, refillPerSecond: 10 / 600 },
  handler: ({ actor }) => {
    const config = googleOAuthConfig();
    if (!config) return redirect('/app/scheduling?calendar=unavailable');
    const state = signCalendarState({ userId: actor.userId, orgId: actor.orgId }, stateSecret());
    const url = googleConsentUrl(config, state);
    return new ApiResult({ redirect: url }, { status: 302, headers: { location: url } });
  },
};

const callbackSchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
});

/** `GET /api/v1/calendar/google/callback`: Google's redirect back with the consent code. */
export const calendarGoogleCallbackRoute: RouteDef<typeof callbackSchema, true> = {
  can: 'scheduling:manage',
  input: callbackSchema,
  handler: async ({ actor, input, tenant }) => {
    const config = googleOAuthConfig();
    if (!config) return redirect('/app/scheduling?calendar=unavailable');
    if (input.error || !input.code || !input.state) {
      return redirect('/app/scheduling?calendar=cancelled');
    }
    const state = verifyCalendarState(input.state, stateSecret());
    if (!state || state.userId !== actor.userId || state.orgId !== actor.orgId) {
      return redirect('/app/scheduling?calendar=error');
    }
    try {
      const { refreshToken, email } = await exchangeGoogleCode(config, input.code);
      await tenant((tx) => saveGoogleConnection(tx, actor, { accountEmail: email, refreshToken }));
    } catch {
      return redirect('/app/scheduling?calendar=error');
    }
    return redirect('/app/scheduling?calendar=connected');
  },
};

/**
 * Busy blocks from the session type coach's Google calendar around a requested slot, for
 * `createBooking`. Fails open: if Google is unreachable the booking still goes through, and the
 * database clash check still applies.
 */
export async function calendarBusyForBooking(
  tenant: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>,
  sessionTypeId: string,
  startsAt: string,
  endsAt: string,
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  const config = googleOAuthConfig();
  const from = new Date(startsAt);
  const to = new Date(endsAt);
  if (!config || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
  const connection = await tenant((tx) => coachConnectionForSessionType(tx, sessionTypeId));
  if (!connection) return [];
  try {
    return await coachBusyTimes(
      config,
      connection,
      new Date(from.getTime() - 2 * 3_600_000),
      new Date(to.getTime() + 2 * 3_600_000),
    );
  } catch {
    return [];
  }
}
