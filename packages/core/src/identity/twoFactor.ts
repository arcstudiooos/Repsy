import type { TenantTx } from '@repsy/db';
import { isCoachRole, STAFF_ROLES } from '../authz/actor';
import type { ActorContext } from '../authz/actor';

export interface TwoFactorStatus {
  enabled: boolean;
  /** PRD A8: an owner must use two-step sign-in once the workspace has more than one coach. */
  required: boolean;
}

/** Whether the signed-in user has two-step sign-in on, and whether this workspace requires it of them. */
export async function twoFactorStatus(tx: TenantTx, actor: ActorContext): Promise<TwoFactorStatus> {
  const user = await tx.user.findFirst({
    where: { id: actor.userId },
    select: { twoFactorEnabled: true },
  });
  const enabled = user?.twoFactorEnabled ?? false;
  if (!isCoachRole(actor.role)) return { enabled, required: false };
  // A workspace with a team requires it of every staff member (PRD A8, A10).
  const coaches = await tx.membership.count({
    where: { role: { in: [...STAFF_ROLES] }, status: 'active' },
  });
  return { enabled, required: coaches > 1 };
}
