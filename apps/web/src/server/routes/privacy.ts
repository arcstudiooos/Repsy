import { z } from 'zod';
import {
  createPilotCode,
  decideDeletion,
  grantSupportAccess,
  listDeletionRequests,
  listMyGrants,
  listPilotCodes,
  lookupAccount,
  readClientForSupport,
  requestDeletion,
  revokeSupportAccess,
} from '@kinetic/core';
import { withSystem } from '@kinetic/db';
import { ApiResult, type RouteCtx, type RouteDef } from '../api';

const requestSchema = z.object({ clientId: z.string().max(64).optional() });

/** `POST /api/v1/deletion-requests`: a client for themselves, an owner for one of their clients (`clientId`). */
export const deletionRequestPostRoute: RouteDef<typeof requestSchema, true> = {
  input: requestSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => requestDeletion(tx, actor, input, { requestId })), {
      status: 202,
    }),
};

// --- platform admin (S5-3): no organization; non-admins get 404 from core ----------------------------------

const adminOf = (ctx: Pick<RouteCtx<unknown, false>, 'user'>) => ({
  userId: ctx.user.id,
  isPlatformAdmin: ctx.user.isPlatformAdmin === true,
});

export const adminPilotCodesListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: (ctx) => withSystem((tx) => listPilotCodes(tx, adminOf(ctx)), ctx.prisma),
};

const pilotSchema = z.object({ days: z.number().int().optional() });

/** Returns the plaintext code once. */
export const adminPilotCodesPostRoute: RouteDef<typeof pilotSchema, false> = {
  requireOrg: false,
  input: pilotSchema,
  handler: async (ctx) =>
    new ApiResult(
      await withSystem((tx) => createPilotCode(tx, adminOf(ctx), ctx.input), ctx.prisma),
      { status: 201, headers: { 'cache-control': 'no-store' } },
    ),
};

const lookupSchema = z.object({ email: z.string().max(254) });

export const adminAccountLookupRoute: RouteDef<typeof lookupSchema, false> = {
  requireOrg: false,
  input: lookupSchema,
  handler: (ctx) =>
    withSystem((tx) => lookupAccount(tx, adminOf(ctx), ctx.input.email), ctx.prisma),
};

export const adminDeletionsListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: (ctx) => withSystem((tx) => listDeletionRequests(tx, adminOf(ctx)), ctx.prisma),
};

const decideSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('reject'), reason: z.string().max(1000) }),
  z.object({ action: z.literal('hold'), on: z.boolean() }),
]);

export const adminDeletionPatchRoute: RouteDef<typeof decideSchema, false> = {
  requireOrg: false,
  input: decideSchema,
  handler: async (ctx) => {
    await withSystem(
      (tx) => decideDeletion(tx, adminOf(ctx), ctx.params.id ?? '', ctx.input),
      ctx.prisma,
    );
    return new ApiResult(null, { status: 204 });
  },
};

export const adminGrantsListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: (ctx) => withSystem((tx) => listMyGrants(tx, adminOf(ctx)), ctx.prisma),
};

const grantSchema = z.object({ clientId: z.string().max(64), reason: z.string().max(1000) });

export const adminGrantPostRoute: RouteDef<typeof grantSchema, false> = {
  requireOrg: false,
  input: grantSchema,
  handler: async (ctx) =>
    new ApiResult(
      await withSystem((tx) => grantSupportAccess(tx, adminOf(ctx), ctx.input), ctx.prisma),
      { status: 201 },
    ),
};

export const adminGrantDeleteRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: async (ctx) => {
    await withSystem(
      (tx) => revokeSupportAccess(tx, adminOf(ctx), ctx.params.id ?? ''),
      ctx.prisma,
    );
    return new ApiResult(null, { status: 204 });
  },
};

/** `GET /api/v1/admin/support/clients/:id`: only with an active grant (else 403). */
export const adminSupportClientRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: (ctx) =>
    withSystem((tx) => readClientForSupport(tx, adminOf(ctx), ctx.params.id ?? ''), ctx.prisma),
};
