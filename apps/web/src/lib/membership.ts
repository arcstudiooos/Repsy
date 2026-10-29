import { withSystem, type PrismaClient } from '@kinetic/db';

export const ONBOARDING_PATH = '/onboarding/pilot-code';

/**
 * Whether the user has an active owner/coach membership. System scope: the
 * active organization is not known yet, and only this user's own rows are read.
 */
export function hasCoachMembership(prisma: PrismaClient | undefined, userId: string) {
  return withSystem(
    async (tx) =>
      (await tx.membership.count({
        where: { userId, status: 'active', role: { in: ['owner', 'coach'] } },
      })) > 0,
    prisma,
  );
}
