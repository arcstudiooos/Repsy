import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DomainError, type ActorContext, type MembershipRef } from '@kinetic/core';
import { withTenant, type TenantTx } from '@kinetic/db';
import { getSessionUser, type SessionUser } from '@/lib/auth';
import { loadMemberships, resolveActor } from './actor';
import type { ActorOutcome } from './shellGate';

/** Session user (null when signed out) and their live memberships. Memoized per request. */
export const getServerSession = cache(
  async (): Promise<{ user: SessionUser | null; memberships: MembershipRef[] }> => {
    const user = await getSessionUser(await headers());
    return { user, memberships: user ? await loadMemberships(user.id) : [] };
  },
);

/**
 * The active org's role for a signed-in user, or the DomainError code resolving it threw
 * (ORG_SELECTION_REQUIRED, NOT_FOUND for a stale cookie, FORBIDDEN for no workspace). Shells route on it.
 */
export async function getServerActorOutcome(user: SessionUser): Promise<ActorOutcome> {
  const { memberships } = await getServerSession();
  try {
    return { role: resolveActor((await headers()).get('cookie'), user, memberships).role };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.code };
    throw error;
  }
}

/**
 * Actor for server components, resolved exactly like apiHandler does (session,
 * live memberships, signed org cookie). Redirects to /login when signed out.
 * Memoized per request.
 */
export const getServerActor = cache(async (): Promise<ActorContext> => {
  const { user, memberships } = await getServerSession();
  if (!user) redirect('/login?next=%2Fapp');
  return resolveActor((await headers()).get('cookie'), user, memberships);
});

/** Runs `fn` in a transaction scoped to the signed-in actor's organization. */
export async function withServerTenant<T>(
  fn: (tx: TenantTx, actor: ActorContext) => Promise<T>,
): Promise<T> {
  const actor = await getServerActor();
  return withTenant(actor.orgId, (tx) => fn(tx, actor), undefined, { userId: actor.userId });
}

/**
 * Runs `fn` scoped to the signed-in client's organization, with `actor.clientId` set from their own Client row
 * (exactly as apiHandler does), so core can scope reads to "my sessions". Portal pages only: the portal layout gate
 * guarantees the client role and the row; anything else is a 404.
 */
export async function withPortalTenant<T>(
  fn: (tx: TenantTx, actor: ActorContext) => Promise<T>,
): Promise<T> {
  const base = await getServerActor();
  if (base.role !== 'client') throw new DomainError('NOT_FOUND', 'Not found.');
  return withTenant(
    base.orgId,
    async (tx) => {
      const own = await tx.client.findFirst({
        where: { userId: base.userId },
        select: { id: true },
      });
      if (!own) throw new DomainError('NOT_FOUND', 'Not found.');
      return fn(tx, { ...base, clientId: own.id });
    },
    undefined,
    { userId: base.userId },
  );
}
