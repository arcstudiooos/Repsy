import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DomainError } from '@kinetic/core';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { ONBOARDING_PATH } from '@/lib/membership';
import { loadMemberships, resolveActor } from '@/server/actor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

/**
 * Role-based landing. Signed out -> /login. Otherwise the active org (signed
 * cookie, else the only membership) decides: owner/coach -> /app, client ->
 * /portal. Several memberships and no valid cookie -> /select-org.
 */
async function Landing(): Promise<never> {
  const h = await headers();
  const user = await getSessionUser(h);
  if (!user) redirect('/login');
  if (!user.emailVerified) redirect('/verify-email');

  const memberships = await loadMemberships(user.id);
  let target: string;
  try {
    const actor = resolveActor(h.get('cookie'), user, memberships);
    target = actor.role === 'client' ? '/portal' : '/app';
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // No workspace at all -> pilot-code recovery; ambiguous or stale org -> chooser.
    target = memberships.length === 0 ? ONBOARDING_PATH : '/select-org';
  }
  redirect(target);
}

export default function Home() {
  // Session + cookies are runtime data: keep them behind a boundary (cacheComponents).
  return (
    <Suspense fallback={<LoadingState />}>
      <Landing />
    </Suspense>
  );
}
