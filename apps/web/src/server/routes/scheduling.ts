import { z } from 'zod';
// NOTE (slice merge): these names are exported from the new core modules
// (packages/core/src/scheduling/*) but NOT yet from '@kinetic/core' itself —
// this slice may not edit packages/core/src/index.ts. The parent adds the
// export lines in SLICE_REPORT_SCHEDULING.md, then these imports resolve.
import {
  cancelBooking,
  createBooking,
  listBookings,
  listSessionTypes,
  saveSessionType,
} from '@kinetic/core';
import { listPacks, purchasePack } from '@kinetic/core';
import { scheduleRenewalReminders, startPackageOnboarding } from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { calendarBusyForBooking } from './calendarSync';

const availabilitySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().max(5),
  endTime: z.string().max(5),
});

const sessionTypeSchema = z.object({
  name: z.string().max(200),
  kind: z.string().max(20),
  durationMinutes: z.number().int(),
  bufferBeforeMinutes: z.number().int().optional(),
  bufferAfterMinutes: z.number().int().optional(),
  reminderMinutesBefore: z.number().int().optional(),
  location: z.string().max(500).nullable().optional(),
  availability: z.array(availabilitySchema).max(50),
  active: z.boolean().optional(),
});

/** `GET /api/v1/scheduling/session-types` (PRD K10). */
export const sessionTypesListRoute: RouteDef<undefined, true> = {
  can: 'session:read',
  handler: ({ actor, tenant }) => tenant((tx) => listSessionTypes(tx, actor)),
};

/** `POST /api/v1/scheduling/session-types` (PRD K10). */
export const sessionTypesPostRoute: RouteDef<typeof sessionTypeSchema, true> = {
  can: 'client:update',
  input: sessionTypeSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => saveSessionType(tx, actor, input)), { status: 201 }),
};

/** `PUT /api/v1/scheduling/session-types/:id` (PRD K10). */
export const sessionTypePutRoute: RouteDef<typeof sessionTypeSchema, true> = {
  can: 'client:update',
  input: sessionTypeSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => saveSessionType(tx, actor, { ...input, id: params.id })),
};

const bookingSchema = z.object({
  sessionTypeId: z.string().max(64),
  clientId: z.string().max(64),
  startsAt: z.string().max(40),
  endsAt: z.string().max(40),
  callLink: z.string().max(2000).nullable().optional(),
  packId: z.string().max(64).nullable().optional(),
});

const bookingsQuerySchema = z.object({ clientId: z.string().max(64) });

/** `GET /api/v1/scheduling/bookings?clientId=…` (PRD K10, H15 call links). */
export const bookingsListRoute: RouteDef<typeof bookingsQuerySchema, true> = {
  can: 'session:read',
  input: bookingsQuerySchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => listBookings(tx, actor, input.clientId)),
};

/** `POST /api/v1/scheduling/bookings` (PRD K10, K11 pack debit, H15 call link). */
export const bookingsPostRoute: RouteDef<typeof bookingSchema, true> = {
  can: 'session:log',
  input: bookingSchema,
  handler: async ({ actor, input, tenant }) => {
    // K10 two-way: the coach's Google busy times block the slot too (fails open).
    const externalBusy = await calendarBusyForBooking(
      tenant,
      input.sessionTypeId,
      input.startsAt,
      input.endsAt,
    );
    return new ApiResult(await tenant((tx) => createBooking(tx, actor, input, { externalBusy })), {
      status: 201,
    });
  },
};

/** `POST /api/v1/scheduling/bookings/:id/cancel` (PRD K10, K11 pack refund). */
export const bookingCancelRoute: RouteDef<undefined, true> = {
  can: 'session:log',
  handler: async ({ actor, params, tenant }) => {
    await tenant((tx) => cancelBooking(tx, actor, params.id ?? ''));
    return { cancelled: true };
  },
};

const packSchema = z.object({
  clientId: z.string().max(64),
  name: z.string().max(200),
  totalSessions: z.number().int(),
  expiresAt: z.string().max(40).nullable().optional(),
});

/** `POST /api/v1/scheduling/packs` (PRD K11). */
export const packsPostRoute: RouteDef<typeof packSchema, true> = {
  can: 'client:update',
  input: packSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => purchasePack(tx, actor, input)), { status: 201 }),
};

/** `GET /api/v1/scheduling/packs?clientId=…` (PRD K11 balance, shown to the client). */
export const packsListRoute: RouteDef<typeof bookingsQuerySchema, true> = {
  can: 'session:read',
  input: bookingsQuerySchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => listPacks(tx, actor, input.clientId)),
};

const onboardingSchema = z.object({
  packageId: z.string().max(64),
  clientId: z.string().max(64),
});

/** `POST /api/v1/scheduling/package-onboarding` (PRD J4). */
export const packageOnboardingRoute: RouteDef<typeof onboardingSchema, true> = {
  can: 'client:update',
  input: onboardingSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => startPackageOnboarding(tx, actor, input)), { status: 201 }),
};

const renewalSchema = z.object({
  packageId: z.string().max(64),
  clientId: z.string().max(64),
  endsAt: z.string().max(40),
  renewalReminderDays: z.number().int().optional(),
});

/** `POST /api/v1/scheduling/renewal-reminders` (PRD J6). */
export const renewalRemindersRoute: RouteDef<typeof renewalSchema, true> = {
  can: 'client:update',
  input: renewalSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => scheduleRenewalReminders(tx, actor, input)),
};
