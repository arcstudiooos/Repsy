import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '@kinetic/core';
import { withTenant, type TenantTx } from '@kinetic/db';
import { getSessionUser } from '@/lib/auth';
import { loadMemberships, resolveActor } from './actor';

/**
 * Actor for server components, resolved exactly like apiHandler does (session,
 * live memberships, signed org cookie). Redirects to /login when signed out.
 * Memoized per request.
 */
export const getServerActor = cache(async (): Promise<ActorContext> => {
  const h = await headers();
  const user = await getSessionUser(h);
  if (!user) redirect('/login?next=%2Fapp');
  const memberships = await loadMemberships(user.id);
  return resolveActor(h.get('cookie'), user, memberships);
});

/** Runs `fn` in a transaction scoped to the signed-in actor's organization. */
export async function withServerTenant<T>(
  fn: (tx: TenantTx, actor: ActorContext) => Promise<T>,
): Promise<T> {
  const actor = await getServerActor();
  return withTenant(actor.orgId, (tx) => fn(tx, actor), undefined, { userId: actor.userId });
}
