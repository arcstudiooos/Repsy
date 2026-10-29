import { appendAudit, withTenant } from '@kinetic/db';
import type { RouteDef } from '../api';

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
