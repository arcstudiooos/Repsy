import { z } from 'zod';
import {
  addTimeOff,
  calendarPorts,
  cancelBooking,
  createBooking,
  creditBalance,
  disconnectCalendar,
  DomainError,
  getCalendarConnection,
  getSchedule,
  listBookings,
  listSessionTypes,
  listSlots,
  markBooking,
  removeTimeOff,
  saveCalendarConnection,
  saveSessionType,
  seal,
  sealContext,
  sealKeyFromEnv,
  setAvailability,
  signCalendarState,
  verifyCalendarState,
  type CalendarProvider,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { orgCookieSecret } from '../orgCookie';
import { appOrigin } from '../payments';

/** PRD K10, K11, H15 (D-013 #11, #12): session types, availability, slots, bookings, credits and calendar sync. */

const optDate = (v: string | undefined) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// ---------------------------------------------------------------- session types

const typesQuery = z.object({
  coachUserId: z.string().max(64).optional(),
  all: z.enum(['1']).optional(),
});

export const sessionTypesGetRoute: RouteDef<typeof typesQuery, true> = {
  input: typesQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) =>
      listSessionTypes(tx, actor, {
        ...(input.coachUserId ? { coachUserId: input.coachUserId } : {}),
        includeInactive: input.all === '1',
      }),
    ),
};

const typeSchema = z.object({
  coachUserId: z.string().max(64).optional(),
  title: z.string().max(200),
  kind: z.string().max(20),
  durationMin: z.number(),
  bufferBeforeMin: z.number().optional(),
  bufferAfterMin: z.number().optional(),
  minNoticeHours: z.number().optional(),
  maxDaysAhead: z.number().optional(),
  cancelWindowHours: z.number().optional(),
  callLink: z.string().max(600).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  usesCredit: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const sessionTypesPostRoute: RouteDef<typeof typeSchema, true> = {
  can: 'schedule:manage',
  input: typeSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => saveSessionType(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const sessionTypePutRoute: RouteDef<typeof typeSchema, true> = {
  can: 'schedule:manage',
  input: typeSchema,
  handler: ({ actor, input, params, requestId, tenant }) =>
    tenant((tx) => saveSessionType(tx, actor, { ...input, id: params.id ?? '' }, { requestId })),
};

// ---------------------------------------------------------------- availability and time off

const scheduleQuery = z.object({ coachUserId: z.string().max(64).optional() });

export const scheduleGetRoute: RouteDef<typeof scheduleQuery, true> = {
  can: 'schedule:read',
  input: scheduleQuery,
  handler: ({ actor, input, tenant }) => tenant((tx) => getSchedule(tx, actor, input.coachUserId)),
};

const availabilitySchema = z.object({
  coachUserId: z.string().max(64).optional(),
  timezone: z.string().max(64),
  windows: z
    .array(z.object({ weekday: z.number(), start: z.string().max(5), end: z.string().max(5) }))
    .max(30),
});

export const availabilityPutRoute: RouteDef<typeof availabilitySchema, true> = {
  can: 'schedule:manage',
  input: availabilitySchema,
  handler: async ({ actor, input, requestId, tenant }) => {
    await tenant((tx) => setAvailability(tx, actor, input, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const timeOffSchema = z.object({
  coachUserId: z.string().max(64).optional(),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  note: z.string().max(300).optional(),
});

export const timeOffPostRoute: RouteDef<typeof timeOffSchema, true> = {
  can: 'schedule:manage',
  input: timeOffSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => addTimeOff(tx, actor, input)), { status: 201 }),
};

export const timeOffDeleteRoute: RouteDef<undefined, true> = {
  can: 'schedule:manage',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => removeTimeOff(tx, actor, params.id ?? ''));
    return new ApiResult(null, { status: 204 });
  },
};

// ---------------------------------------------------------------- slots, bookings, credits

const slotsQuery = z.object({
  sessionTypeId: z.string().max(64),
  clientId: z.string().max(64).optional(),
  days: z.coerce.number().int().min(1).max(62).optional(),
});

export const slotsGetRoute: RouteDef<typeof slotsQuery, true> = {
  input: slotsQuery,
  rateLimit: { capacity: 60, refillPerSecond: 1 },
  handler: ({ actor, input, tenant }) => tenant((tx) => listSlots(tx, actor, input)),
};

const bookingsQuery = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  clientId: z.string().max(64).optional(),
  coachUserId: z.string().max(64).optional(),
  canceled: z.enum(['1']).optional(),
});

export const bookingsGetRoute: RouteDef<typeof bookingsQuery, true> = {
  input: bookingsQuery,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) =>
      listBookings(tx, actor, {
        from: optDate(input.from),
        to: optDate(input.to),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.coachUserId ? { coachUserId: input.coachUserId } : {}),
        includeCanceled: input.canceled === '1',
      }),
    ),
};

const bookSchema = z.object({
  sessionTypeId: z.string().max(64),
  startsAt: z.string().max(40),
  clientId: z.string().max(64).optional(),
});

export const bookingsPostRoute: RouteDef<typeof bookSchema, true> = {
  input: bookSchema,
  rateLimit: { capacity: 10, refillPerSecond: 10 / 60 },
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => createBooking(tx, actor, input, { requestId })), {
      status: 201,
    }),
};

export const bookingCancelRoute: RouteDef<undefined, true> = {
  rateLimit: { capacity: 10, refillPerSecond: 10 / 60 },
  handler: ({ actor, params, requestId, tenant }) =>
    tenant((tx) => cancelBooking(tx, actor, params.id ?? '', { requestId })),
};

const outcomeSchema = z.object({ outcome: z.enum(['completed', 'no_show']) });

export const bookingOutcomeRoute: RouteDef<typeof outcomeSchema, true> = {
  can: 'schedule:manage',
  input: outcomeSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    await tenant((tx) => markBooking(tx, actor, params.id ?? '', input.outcome, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};

const creditsQuery = z.object({ clientId: z.string().max(64).optional() });

export const creditsGetRoute: RouteDef<typeof creditsQuery, true> = {
  input: creditsQuery,
  handler: ({ actor, input, tenant }) => tenant((tx) => creditBalance(tx, actor, input.clientId)),
};

// ---------------------------------------------------------------- calendar connection

const ports = () => calendarPorts(process.env, appOrigin());

/** The calendar providers this deployment offers. */
export const availableCalendars = (): CalendarProvider[] =>
  Object.keys(ports()) as CalendarProvider[];

const providerParam = (v: string | undefined): CalendarProvider => {
  if (v === 'google' || v === 'outlook' || v === 'fake') return v;
  throw new DomainError('NOT_FOUND', 'Not found.');
};

const callbackUrl = (p: CalendarProvider) => `${appOrigin()}/api/v1/calendar/connect/${p}/callback`;

export const calendarConnectionGetRoute: RouteDef<undefined, true> = {
  can: 'schedule:manage',
  handler: async ({ actor, tenant }) => ({
    connection: await tenant((tx) => getCalendarConnection(tx, actor)),
    providers: availableCalendars(),
  }),
};

/** `GET /api/v1/calendar/connect/:provider`: off to the provider's consent page. */
export const calendarConnectStartRoute: RouteDef<undefined, true> = {
  can: 'schedule:manage',
  handler: ({ actor, params }) => {
    const provider = providerParam(params.provider);
    const port = ports()[provider];
    if (!port) throw new DomainError('NOT_FOUND', 'This calendar is not available.');
    const state = signCalendarState(
      orgCookieSecret(),
      actor.userId,
      actor.orgId,
      provider,
      Date.now(),
    );
    return Response.redirect(port.authorizeUrl(state, callbackUrl(provider)), 302);
  },
};

const callbackSchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(500).optional(),
  error: z.string().max(200).optional(),
});

/** `GET /api/v1/calendar/connect/:provider/callback`: stores the sealed tokens, back to the schedule page. */
export const calendarConnectCallbackRoute: RouteDef<typeof callbackSchema, true> = {
  can: 'schedule:manage',
  input: callbackSchema,
  handler: async ({ actor, input, params, requestId, tenant }) => {
    const provider = providerParam(params.provider);
    const back = (status: string) =>
      Response.redirect(`${appOrigin()}/app/schedule?calendar=${status}`, 302);
    if (input.error || !input.code || !input.state) return back('cancelled');
    if (
      !verifyCalendarState(
        orgCookieSecret(),
        input.state,
        actor.userId,
        actor.orgId,
        provider,
        Date.now(),
      )
    ) {
      return back('expired');
    }
    const port = ports()[provider];
    const key = sealKeyFromEnv(process.env);
    if (!port || !key) return back('unavailable');
    const { tokens, email } = await port.exchangeCode(
      input.code,
      callbackUrl(provider),
      new Date(),
    );
    const tokenCiphertext = seal(
      key,
      JSON.stringify(tokens),
      sealContext(actor.orgId, actor.userId),
    );
    await tenant((tx) =>
      saveCalendarConnection(
        tx,
        actor,
        { provider, tokenCiphertext, accountEmail: email },
        { requestId },
      ),
    );
    return back('ok');
  },
};

export const calendarDisconnectRoute: RouteDef<undefined, true> = {
  can: 'schedule:manage',
  handler: async ({ actor, requestId, tenant }) => {
    await tenant((tx) => disconnectCalendar(tx, actor, { requestId }));
    return new ApiResult(null, { status: 204 });
  },
};
