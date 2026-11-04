import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { isCoachRole, twoFactorStatus } from '@kinetic/core';
import { CoachNav } from '@/components/nav/CoachNav';
import { CoachNavServer } from '@/components/nav/CoachNavServer';
import { NoticeBanner } from '@/components/nav/NoticeBanner';
import { PathBreadcrumbs } from '@/components/nav/PathBreadcrumbs';
import { WorkspaceSwitchLink } from '@/components/nav/WorkspaceSwitchLink';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerActorOutcome, getServerSession, withServerTenant } from '@/server/serverActor';
import { shellRedirect } from '@/server/shellGate';
import { RepsyLogo } from '@/components/brand/Logo';

/**
 * Defense in depth behind src/proxy.ts: needs a verified user with an active owner/coach membership, and the
 * active org must be one where they coach. A client role there goes to /portal; no chosen or a stale active org
 * goes to /select-org (I4: dual-role users never hit a generic FORBIDDEN error page).
 */
async function MembershipGate({
  children,
  loginNext,
  noMembershipPath,
}: {
  children: ReactNode;
  loginNext: string;
  noMembershipPath: string;
}) {
  const { user, memberships } = await getServerSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  if (!user.emailVerified) redirect('/verify-email');
  if (!memberships.some((m) => isCoachRole(m.role))) redirect(noMembershipPath);
  const target = shellRedirect('coach', await getServerActorOutcome(user));
  if (target) redirect(target);
  return (
    <>
      <Suspense fallback={null}>
        <NoticeBanner />
      </Suspense>
      <Suspense fallback={null}>
        <TwoFactorRequiredBanner />
      </Suspense>
      <Suspense fallback={null}>
        <TrialBanner />
      </Suspense>
      {children}
    </>
  );
}

/** PRD A4: days left in a self-serve trial, or that it ended (clients and data are kept). */
async function TrialBanner() {
  const org = await withServerTenant((tx, actor) =>
    tx.organization.findFirst({
      where: { id: actor.orgId },
      select: { trialEndsAt: true, activeClientLimit: true },
    }),
  ).catch(() => null);
  if (!org?.trialEndsAt) return null;
  const left = Math.ceil((org.trialEndsAt.getTime() - Date.now()) / 86_400_000);
  return (
    <div role="status" className="mb-6 rounded-card bg-surface p-4 shadow-card ring-1 ring-accent">
      <p className="font-medium">
        {left > 0
          ? `Free trial: ${left} ${left === 1 ? 'day' : 'days'} left`
          : 'Your free trial has ended'}
      </p>
      <p className="text-sm text-secondary">
        {left > 0
          ? `Up to ${org.activeClientLimit} active clients during the trial.`
          : 'Your clients and data are kept. Adding new clients needs a plan.'}{' '}
        <Link href="/plan" className="text-accent underline">
          See the plan
        </Link>
      </p>
    </div>
  );
}

/** PRD A8: an owner of a workspace with more than one coach is asked to turn on two-step sign-in. */
async function TwoFactorRequiredBanner() {
  const status = await withServerTenant((tx, actor) => twoFactorStatus(tx, actor)).catch(
    () => null,
  );
  if (!status?.required || status.enabled) return null;
  return (
    <div role="status" className="mb-6 rounded-card bg-surface p-4 shadow-card ring-1 ring-warning">
      <p className="font-medium">Turn on two-step sign-in</p>
      <p className="text-sm text-secondary">
        Your workspace has more than one coach, so the owner account needs a code from an
        authenticator app at sign-in.{' '}
        <Link href="/settings" className="text-accent underline">
          Set it up in Settings
        </Link>
      </p>
    </div>
  );
}

/**
 * Coach shell: left rail on desktop, bottom nav on mobile (375 / 768 / 1440).
 * `noMembershipPath` is where users without a coach membership are sent.
 */
export function CoachShell({
  children,
  loginNext,
  noMembershipPath,
}: {
  children: ReactNode;
  loginNext: string;
  noMembershipPath: string;
}) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[var(--rail-w,15.5rem)_minmax(0,1fr)] print:block">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      {/* usePathname() is runtime data: keep it out of the prerendered shell for dynamic routes. */}
      <Suspense fallback={<CoachNav />}>
        <CoachNavServer
          switcher={
            <Suspense fallback={null}>
              <WorkspaceSwitchLink className="text-on-midnight-muted hover:bg-midnight-2 hover:text-on-midnight" />
            </Suspense>
          }
        />
      </Suspense>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur md:hidden print:hidden">
          <p>
            <RepsyLogo size="sm" />
          </p>
          <Suspense fallback={null}>
            <WorkspaceSwitchLink className="text-sm" />
          </Suspense>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-8 md:pb-12"
        >
          <div className="print:hidden">
            <Suspense fallback={null}>
              <PathBreadcrumbs />
            </Suspense>
          </div>
          <Suspense fallback={<LoadingState />}>
            <MembershipGate loginNext={loginNext} noMembershipPath={noMembershipPath}>
              {children}
            </MembershipGate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
