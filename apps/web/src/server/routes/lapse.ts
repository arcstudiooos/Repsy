import { z } from 'zod';
import { getLapseAccess, setSubscriptionLapse } from '@kinetic/core';
import type { RouteDef } from '../api';
import { withPlatformAdmin } from '../platformAdmin';

/**
 * `GET /api/v1/lapse` (PRD M12): this workspace's lapse status for the acting user. Exempt from the lapse gate so a
 * lapsed workspace can still see why it is read-only.
 */
export const lapseGetRoute: RouteDef<undefined, true> = {
  can: 'session:read',
  lapse: 'exempt',
  handler: ({ actor, tenant }) => tenant((tx) => getLapseAccess(tx, actor)),
};

const adminLapseSchema = z.object({
  organizationId: z.string().max(64),
  action: z.enum(['lapse', 'resolve']),
  reason: z.string().max(120).nullable().optional(),
  lapsedAt: z.string().max(40).nullable().optional(),
});

/**
 * `POST /api/v1/admin/lapses` (PRD M12): a platform admin records a workspace's lapse or ends it. Never the workspace
 * itself, so an owner cannot lift their own read-only mode. Billing for the coach's own plan will call the same core
 * function once it exists.
 */
export const adminLapsePostRoute: RouteDef<typeof adminLapseSchema, false> = {
  requireOrg: false,
  requirePlatformAdmin: true,
  input: adminLapseSchema,
  handler: (ctx) =>
    withPlatformAdmin(
      ctx.user,
      (tx, admin) => setSubscriptionLapse(tx, admin, ctx.input),
      ctx.prisma,
    ),
};
