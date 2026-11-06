import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DomainError } from '@kinetic/core';
import { Landing as MarketingHome } from '@/components/marketing/Landing';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { ONBOARDING_PATH } from '@/lib/membership';
import { loadMemberships, resolveActor } from '@/server/actor';

/**
 * Role-based landing. Signed out -> the marketing home page. Otherwise the active org (signed
 * cookie, else the only membership) decides: owner/coach -> /app, client ->
 * /portal. Several memberships and no valid cookie -> /select-org.
 */
async function Landing() {
  const h = await headers();
  const user = await getSessionUser(h);
  // Signed out: the marketing home page (landing PRD). Signed in: straight to the right shell.
  if (!user) return <MarketingHome />;
  if (!user.emailVerified) redirect('/verify-email');

  const memberships = await loadMemberships(user.id);
  let target: string;
  try {
    const actor = resolveActor(h.get('cookie'), user, memberships);
    target = actor.role === 'client' ? '/portal' : '/app';
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // No workspace at all -> pilot-code recovery; ambiguous or stale org -> chooser.
    target =
      memberships.length > 0 ? '/select-org' : user.isPlatformAdmin ? '/admin' : ONBOARDING_PATH;
  }
  redirect(target);
}

export const metadata: Metadata = {
  title: 'Repsy | Coaching software that never drops the ball',
  description:
    "Programs, check-ins, messages and scheduling for online and hybrid coaches. Clients' logs save with no signal, and every feature is on every plan.",
  openGraph: {
    title: 'Repsy | Coaching software that never drops the ball',
    description:
      'Programs, check-ins, messages and scheduling in one place. Every feature on every plan.',
    type: 'website',
  },
};

export default function Home() {
  // Session + cookies are runtime data: keep them behind a boundary (cacheComponents).
  return (
    <Suspense fallback={<LoadingState />}>
      <Landing />
    </Suspense>
  );
}
