import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  assertWorkspaceAccess,
  DomainError,
  type ActorContext,
  type MembershipRef,
} from '@kinetic/core';
import { prisma, withTenant, type TenantTx } from '@kinetic/db';
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

/**
 * PRD M12 (D-013 #16): once a lapsed workspace's read window has closed for this member, its pages give way to
 * /closed. (Writes are refused by apiHandler; pages only read.)
 */
async function readGate(actor: ActorContext): Promise<void> {
  try {
    await assertWorkspaceAccess(prisma, actor, { write: false });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'WORKSPACE_LAPSED') redirect('/closed');
    throw error;
  }
}

/** Runs `fn` in a transaction scoped to the signed-in actor's organization. */
export async function withServerTenant<T>(
  fn: (tx: TenantTx, actor: ActorContext) => Promise<T>,
): Promise<T> {
  const actor = await getServerActor();
  await readGate(actor);
  return withTenant(actor.orgId, (tx) => fn(tx, actor), undefined, { userId: actor.userId });
}

/**
 * Runs `fn` scoped to the signed-in client's organization, with `actor.clientId` set from their own Client row
 * (exactly as apiHandler does), so core can scope reads to "my sessions". Portal pages only: the portal layout gate
 * guarantees the client role and the row; anything else renders the 404 page.
 */
export async function withPortalTenant<T>(
  fn: (tx: TenantTx, actor: ActorContext) => Promise<T>,
): Promise<T> {
  const base = await getServerActor();
  if (base.role !== 'client') notFound();
  await readGate(base);
  return withTenant(
    base.orgId,
    async (tx) => {
      const own = await tx.client.findFirst({
        where: { userId: base.userId, status: { not: 'archived' } },
        select: { id: true },
      });
      if (!own) notFound();
      return fn(tx, { ...base, clientId: own.id });
    },
    undefined,
    { userId: base.userId },
  );
}
