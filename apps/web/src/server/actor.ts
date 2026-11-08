import {
  DomainError,
  highestRole,
  type ActorContext,
  type MembershipRef,
  type Role,
} from '@repsy/core';
import { withSystem, type PrismaClient } from '@repsy/db';
import type { SessionUser } from '@/lib/auth';
import { ORG_COOKIE, orgCookieSecret, readCookie, verifyOrgCookie } from './orgCookie';

/**
 * All of the user's active memberships. System scope: memberships span orgs,
 * and only this user's own rows are read.
 */
export function loadMemberships(userId: string, prisma?: PrismaClient): Promise<MembershipRef[]> {
  return withSystem(
    async (tx) =>
      (
        await tx.membership.findMany({
          where: { userId, status: 'active' },
          select: { organizationId: true, role: true },
        })
      ).map((m): MembershipRef => ({ orgId: m.organizationId, role: m.role as Role })),
    prisma,
  );
}

/**
 * Active org: signed `repsy_org` cookie (bound to the user, re-checked against
 * live memberships), else the sole membership. A bad signature counts as absent;
 * a valid signature for an org the user does not belong to is a 404 so that
 * org existence never leaks.
 *
 * Shared by apiHandler (request cookies) and server components (next/headers).
 */
export function resolveActor(
  cookieHeader: string | null,
  user: SessionUser,
  memberships: MembershipRef[],
  secret: string = orgCookieSecret(),
): ActorContext {
  const cookie = readCookie(cookieHeader, ORG_COOKIE);
  const cookieOrg = cookie ? verifyOrgCookie(cookie, user.id, secret) : null;
  let orgId: string;
  if (cookieOrg !== null) {
    orgId = cookieOrg;
  } else {
    const orgIds = [...new Set(memberships.map((m) => m.orgId))];
    if (orgIds.length === 0) throw new DomainError('FORBIDDEN', 'No active workspace.');
    if (orgIds.length > 1) {
      throw new DomainError('ORG_SELECTION_REQUIRED', 'Choose a workspace to continue.');
    }
    orgId = orgIds[0] as string;
  }
  const role = highestRole(memberships.filter((m) => m.orgId === orgId).map((m) => m.role));
  if (role === undefined) throw new DomainError('NOT_FOUND', 'Not found.');
  return { userId: user.id, orgId, role, isPlatformAdmin: user.isPlatformAdmin };
}
