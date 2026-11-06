import { withSystem, type PrismaClient } from '@kinetic/db';
import { STAFF_ROLES } from '@kinetic/core';

export const ONBOARDING_PATH = '/onboarding/pilot-code';

/**
 * Whether the user has an active owner/coach membership. System scope: the
 * active organization is not known yet, and only this user's own rows are read.
 */
export function hasCoachMembership(prisma: PrismaClient | undefined, userId: string) {
  return withSystem(
    async (tx) =>
      (await tx.membership.count({
        where: { userId, status: 'active', role: { in: [...STAFF_ROLES] } },
      })) > 0,
    prisma,
  );
}

/**
 * Where a verified user who opens the coach app without a coach membership belongs: their client portal when
 * they are a client somewhere, the admin console for a platform admin with no workspace, otherwise pilot-code
 * recovery. Clients and admins must not land on the coach-trial page (QA 2026-11-06, S3).
 */
export async function noCoachMembershipTarget(
  prisma: PrismaClient | undefined,
  user: { id: string; isPlatformAdmin: boolean },
): Promise<string> {
  const isClient = await withSystem(
    async (tx) =>
      (await tx.membership.count({
        where: { userId: user.id, status: 'active', role: 'client' },
      })) > 0,
    prisma,
  );
  if (isClient) return '/portal';
  return user.isPlatformAdmin ? '/admin' : ONBOARDING_PATH;
}
