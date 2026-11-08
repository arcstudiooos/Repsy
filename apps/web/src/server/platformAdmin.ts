import { DomainError, type PlatformAdmin } from '@repsy/core';
import { withSystem, type PrismaClient, type SystemTx } from '@repsy/db';

/** The authenticated user as far as the admin gate cares (a `SessionUser`, or none when signed out). */
export interface AdminCandidate {
  id: string;
  isPlatformAdmin?: boolean | null;
}

/**
 * The acting platform admin, or NOT_FOUND: the console is invisible to everyone else (S5-3). Decided from the
 * authenticated user alone, with no database access.
 */
export function platformAdminOf(user: AdminCandidate | null | undefined): PlatformAdmin {
  if (user?.isPlatformAdmin !== true) throw new DomainError('NOT_FOUND', 'Not found.');
  return { userId: user.id, isPlatformAdmin: true };
}

/**
 * The platform-admin console's only door into system scope (PR #2 review I1). It authorizes the user first, outside
 * any transaction, and only then opens the `withSystem` (RLS bypass) transaction: cross-organization by design (the
 * deletion queue, support grants, account lookup, pilot codes). The core admin functions assert again inside, as
 * defence in depth. Listed in the `withSystem` inventory (packages/db/src/tenant.ts).
 */
export async function withPlatformAdmin<T>(
  user: AdminCandidate | null | undefined,
  fn: (tx: SystemTx, admin: PlatformAdmin) => Promise<T>,
  client?: PrismaClient,
): Promise<T> {
  const admin = platformAdminOf(user);
  return withSystem((tx) => fn(tx, admin), client);
}
