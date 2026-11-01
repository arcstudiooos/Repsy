import { appendAudit, withTenant } from '@kinetic/db';
import { DomainError } from '@kinetic/core';
import { describeDevice } from '@/lib/device';
import { ApiResult, type RouteDef } from '../api';

/**
 * Signs the caller out of every other device (Better Auth deletes the other
 * session rows); the current session stays. Audited when an org is active.
 */
export const sessionsRevokeAllRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: async ({ request, requestId, user, auth, prisma, optionalActor }) => {
    await auth.api.revokeOtherSessions({ headers: request.headers });
    const actor = optionalActor();
    if (actor) {
      await withTenant(
        actor.orgId,
        (tx) =>
          appendAudit(tx, {
            orgId: actor.orgId,
            actorId: user.id,
            objectType: 'session',
            objectId: user.id,
            action: 'session.revoked_all',
            requestId,
          }),
        prisma,
        { userId: user.id },
      );
    }
    return { revoked: true };
  },
};

export interface DeviceSessionView {
  /** An opaque id; session tokens never leave the server (D-006 #5). */
  id: string;
  current: boolean;
  device: string;
  createdAt: string;
  lastActiveAt: string;
}

type BetterAuthSession = {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

/** `GET /api/v1/me/sessions` (PRD A9): the caller's signed-in devices, current first. */
export const deviceSessionsRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: async ({ request, auth }) => {
    const current = await auth.api.getSession({ headers: request.headers });
    const list = (await auth.api.listSessions({ headers: request.headers })) as BetterAuthSession[];
    const iso = (d: Date | string) => new Date(d).toISOString();
    return list
      .map((s): DeviceSessionView => ({
        id: s.id,
        current: s.id === current?.session.id,
        device: describeDevice(s.userAgent),
        createdAt: iso(s.createdAt),
        lastActiveAt: iso(s.updatedAt),
      }))
      .sort((a, b) =>
        a.current === b.current ? b.lastActiveAt.localeCompare(a.lastActiveAt) : a.current ? -1 : 1,
      );
  },
};

/** `DELETE /api/v1/me/sessions/:id`: sign out one other device (not this one: use Sign out). Audited when an org is active. */
export const deviceSessionRevokeRoute: RouteDef<undefined, false> = {
  requireOrg: false,
  handler: async ({ request, requestId, user, auth, prisma, params, optionalActor }) => {
    const current = await auth.api.getSession({ headers: request.headers });
    const list = (await auth.api.listSessions({ headers: request.headers })) as BetterAuthSession[];
    const target = list.find((s) => s.id === params.id);
    if (!target) throw new DomainError('NOT_FOUND', 'Not found.');
    if (target.id === current?.session.id) {
      throw new DomainError('CONFLICT', 'This is the device you are using. Use Sign out instead.');
    }
    await auth.api.revokeSession({ headers: request.headers, body: { token: target.token } });
    const actor = optionalActor();
    if (actor) {
      await withTenant(
        actor.orgId,
        (tx) =>
          appendAudit(tx, {
            orgId: actor.orgId,
            actorId: user.id,
            objectType: 'session',
            objectId: user.id,
            action: 'session.revoked_one',
            requestId,
          }),
        prisma,
        { userId: user.id },
      );
    }
    return new ApiResult(null, { status: 204 });
  },
};
