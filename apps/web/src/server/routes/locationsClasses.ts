import { z } from 'zod';
import {
  cancelClass,
  cancelEnrollment,
  classRoster,
  createClassSeries,
  enrollInClass,
  listClasses,
  listLocations,
  markAttendance,
  saveLocation,
  setClassCapacity,
  setClientLocation,
  setLocationArchived,
  setStaffLocation,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';

/* ---------------------------------------------------------------- PRD A15 */

const locationSchema = z.object({
  name: z.string().max(200),
  address: z.string().max(400).nullable().optional(),
});

/** `GET /api/v1/locations`: active locations (for pickers and the Locations page). */
export const locationsListRoute: RouteDef<undefined, true> = {
  can: 'org:read',
  handler: ({ actor, tenant }) => tenant((tx) => listLocations(tx, actor)),
};

/** `POST /api/v1/locations`. Managers. */
export const locationsPostRoute: RouteDef<typeof locationSchema, true> = {
  can: 'location:manage',
  input: locationSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => saveLocation(tx, actor, input)), { status: 201 }),
};

const locationPatchSchema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(400).nullable().optional(),
  archived: z.boolean().optional(),
});

/** `PATCH /api/v1/locations/:id`: rename, or archive/restore. Managers. */
export const locationPatchRoute: RouteDef<typeof locationPatchSchema, true> = {
  can: 'location:manage',
  input: locationPatchSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant(async (tx) => {
      const id = params.id ?? '';
      if (input.name !== undefined) {
        await saveLocation(tx, actor, { id, name: input.name, address: input.address });
      }
      if (input.archived !== undefined) await setLocationArchived(tx, actor, id, input.archived);
      return { id };
    }),
};

const staffLocationSchema = z.object({
  userId: z.string().max(64),
  locationId: z.string().max(64).nullable(),
});

/** `PUT /api/v1/locations/staff`: tie a team member to a location. Managers. */
export const staffLocationRoute: RouteDef<typeof staffLocationSchema, true> = {
  can: 'location:manage',
  input: staffLocationSchema,
  handler: ({ actor, input, tenant }) =>
    tenant((tx) => setStaffLocation(tx, actor, input.userId, input.locationId)),
};

const clientLocationSchema = z.object({ locationId: z.string().max(64).nullable() });

/** `PUT /api/v1/clients/:id/location`. Trainers. */
export const clientLocationRoute: RouteDef<typeof clientLocationSchema, true> = {
  can: 'client:update',
  input: clientLocationSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => setClientLocation(tx, actor, params.id ?? '', input.locationId)),
};

/* ---------------------------------------------------------------- PRD K12 */

const rangeSchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  locationId: z.string().max(64).optional(),
});

const DAY = 86_400_000;
const dateOr = (value: string | undefined, fallback: Date) => {
  const d = value ? new Date(value) : fallback;
  return Number.isNaN(d.getTime()) ? fallback : d;
};

/** `GET /api/v1/classes?from&to&locationId`: defaults to the next 14 days, at most 120. */
export const classesListRoute: RouteDef<typeof rangeSchema, true> = {
  can: 'class:read',
  input: rangeSchema,
  handler: ({ actor, input, tenant }) => {
    const from = dateOr(input.from, new Date());
    const to = dateOr(input.to, new Date(from.getTime() + 14 * DAY));
    const capped =
      to.getTime() - from.getTime() > 120 * DAY ? new Date(from.getTime() + 120 * DAY) : to;
    return tenant((tx) =>
      listClasses(tx, actor, { from, to: capped, locationId: input.locationId }),
    );
  },
};

const classSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000).nullable().optional(),
  startsAt: z.string().max(40),
  durationMinutes: z.number().int(),
  capacity: z.number().int(),
  repeatWeeks: z.number().int().optional(),
  locationId: z.string().max(64).nullable().optional(),
  coachUserId: z.string().max(64).nullable().optional(),
});

/** `POST /api/v1/classes`: schedule a class, optionally weekly. Trainers. */
export const classesPostRoute: RouteDef<typeof classSchema, true> = {
  can: 'class:manage',
  input: classSchema,
  handler: async ({ actor, input, tenant }) =>
    new ApiResult(await tenant((tx) => createClassSeries(tx, actor, input)), { status: 201 }),
};

/** `GET /api/v1/classes/:id/roster`. Trainers. */
export const classRosterRoute: RouteDef<undefined, true> = {
  can: 'class:manage',
  handler: ({ actor, params, tenant }) => tenant((tx) => classRoster(tx, actor, params.id ?? '')),
};

const enrollSchema = z.object({ clientId: z.string().max(64).optional() });

/** `POST /api/v1/classes/:id/enroll`: a client books themself; staff book any client. */
export const classEnrollRoute: RouteDef<typeof enrollSchema, true> = {
  can: 'class:book',
  input: enrollSchema,
  rateLimit: { capacity: 60, refillPerSecond: 60 / 3600 },
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) =>
      enrollInClass(tx, actor, { classId: params.id ?? '', clientId: input.clientId }),
    ),
};

/** `POST /api/v1/classes/:id/leave`: cancel a place; the waitlist moves up. */
export const classLeaveRoute: RouteDef<typeof enrollSchema, true> = {
  can: 'class:book',
  input: enrollSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) =>
      cancelEnrollment(tx, actor, { classId: params.id ?? '', clientId: input.clientId }),
    ),
};

const capacitySchema = z.object({ capacity: z.number().int() });

/** `PATCH /api/v1/classes/:id`: change capacity. Trainers. */
export const classPatchRoute: RouteDef<typeof capacitySchema, true> = {
  can: 'class:manage',
  input: capacitySchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => setClassCapacity(tx, actor, params.id ?? '', input.capacity)),
};

const cancelSchema = z.object({ wholeSeries: z.boolean().optional() });

/** `POST /api/v1/classes/:id/cancel`: this class, or the rest of its series. Trainers. */
export const classCancelRoute: RouteDef<typeof cancelSchema, true> = {
  can: 'class:manage',
  input: cancelSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => cancelClass(tx, actor, params.id ?? '', { wholeSeries: input.wholeSeries })),
};

const attendanceSchema = z.object({
  marks: z.array(z.object({ clientId: z.string().max(64), attended: z.boolean() })).max(500),
});

/** `PUT /api/v1/classes/:id/attendance`. Trainers. */
export const classAttendanceRoute: RouteDef<typeof attendanceSchema, true> = {
  can: 'class:manage',
  input: attendanceSchema,
  handler: ({ actor, input, params, tenant }) =>
    tenant((tx) => markAttendance(tx, actor, params.id ?? '', input.marks)),
};
