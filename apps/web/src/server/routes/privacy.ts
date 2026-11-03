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
  postNotice,
  resolveNotice,
  setWorkspaceLapsed,
  clearLapseCache,
} from '@kinetic/core';
import { ApiResult, type RouteCtx, type RouteDef } from '../api';
import { withPlatformAdmin } from '../platformAdmin';

const requestSchema = z.object({ clientId: z.string().max(64).optional() });

/** `POST /api/v1/deletion-requests`: a client for themselves, an owner for one of their clients (`clientId`). */
export const deletionRequestPostRoute: RouteDef<typeof requestSchema, true> = {
  // PRD M12: still allowed after the workspace lapses.
  allowWhenLapsed: true,
  input: requestSchema,
  handler: async ({ actor, input, requestId, tenant }) =>
    new ApiResult(await tenant((tx) => requestDeletion(tx, actor, input, { requestId })), {
      status: 202,
    }),
};

// --- platform admin (S5-3) ----------------------------------------------------------------------------------
// No organization. `requirePlatformAdmin` answers 404 to everyone else right after authentication, before any
// database access or input validation; `withPlatformAdmin` checks again before it opens system scope (RLS bypass,
// cross-organization by design), and every core admin function asserts once more inside.

type AdminCtx = Pick<RouteCtx<unknown, false>, 'user' | 'prisma'>;
const asAdmin = <T>(ctx: AdminCtx, fn: Parameters<typeof withPlatformAdmin<T>>[1]): Promise<T> =>
  withPlatformAdmin(ctx.user, fn, ctx.prisma);

export const adminPilotCodesListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  handler: (ctx) => asAdmin(ctx, (tx, admin) => listPilotCodes(tx, admin)),
};

const pilotSchema = z.object({ days: z.number().int().optional() });

/** Returns the plaintext code once. */
export const adminPilotCodesPostRoute: RouteDef<typeof pilotSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: pilotSchema,
  handler: async (ctx) =>
    new ApiResult(await asAdmin(ctx, (tx, admin) => createPilotCode(tx, admin, ctx.input)), {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    }),
};

const lookupSchema = z.object({ email: z.string().max(254) });

export const adminAccountLookupRoute: RouteDef<typeof lookupSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: lookupSchema,
  handler: (ctx) => asAdmin(ctx, (tx, admin) => lookupAccount(tx, admin, ctx.input.email)),
};

export const adminDeletionsListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  handler: (ctx) => asAdmin(ctx, (tx, admin) => listDeletionRequests(tx, admin)),
};

const decideSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('reject'), reason: z.string().max(1000) }),
  z.object({ action: z.literal('hold'), on: z.boolean() }),
]);

export const adminDeletionPatchRoute: RouteDef<typeof decideSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: decideSchema,
  handler: async (ctx) => {
    await asAdmin(ctx, (tx, admin) => decideDeletion(tx, admin, ctx.params.id ?? '', ctx.input));
    return new ApiResult(null, { status: 204 });
  },
};

export const adminGrantsListRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  handler: (ctx) => asAdmin(ctx, (tx, admin) => listMyGrants(tx, admin)),
};

const grantSchema = z.object({ clientId: z.string().max(64), reason: z.string().max(1000) });

export const adminGrantPostRoute: RouteDef<typeof grantSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: grantSchema,
  handler: async (ctx) =>
    new ApiResult(await asAdmin(ctx, (tx, admin) => grantSupportAccess(tx, admin, ctx.input)), {
      status: 201,
    }),
};

export const adminGrantDeleteRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  handler: async (ctx) => {
    await asAdmin(ctx, (tx, admin) => revokeSupportAccess(tx, admin, ctx.params.id ?? ''));
    return new ApiResult(null, { status: 204 });
  },
};

/** `GET /api/v1/admin/support/clients/:id`: only with an active grant (else 403). */
export const adminSupportClientRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  handler: (ctx) =>
    asAdmin(ctx, (tx, admin) => readClientForSupport(tx, admin, ctx.params.id ?? '')),
};

const noticeSchema = z.object({ severity: z.string().max(20), message: z.string().max(400) });

/** `POST /api/v1/admin/notices` (PRD M8): post an incident or maintenance notice. */
export const adminNoticePostRoute: RouteDef<typeof noticeSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: noticeSchema,
  handler: async (ctx) =>
    new ApiResult(await asAdmin(ctx, (tx, admin) => postNotice(tx, admin, ctx.input)), {
      status: 201,
    }),
};

const resolveSchema = z.object({ postmortem: z.string().max(6000).optional() });

/** `PATCH /api/v1/admin/notices/:id`: resolve it, optionally with a post-mortem. */
export const adminNoticeResolveRoute: RouteDef<typeof resolveSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: resolveSchema,
  handler: (ctx) =>
    asAdmin(ctx, (tx, admin) => resolveNotice(tx, admin, ctx.params.id ?? '', ctx.input)),
};

const lapseSchema = z.object({ lapsed: z.boolean() });

/** `POST /api/v1/admin/workspaces/:id/lapse` (PRD M12): mark a workspace lapsed, or restore it. */
export const adminWorkspaceLapseRoute: RouteDef<typeof lapseSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: lapseSchema,
  handler: async (ctx) => {
    await asAdmin(ctx, (tx, admin) =>
      setWorkspaceLapsed(tx, admin, ctx.params.id ?? '', ctx.input.lapsed),
    );
    // After the commit, so this process never re-caches the old state (final review #8).
    clearLapseCache(ctx.params.id);
    return new ApiResult(null, { status: 204 });
  },
};
