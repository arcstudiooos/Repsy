import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { isCoachRole } from '@kinetic/core';
import { CoachNav } from '@/components/nav/CoachNav';
import { PathBreadcrumbs } from '@/components/nav/PathBreadcrumbs';
import { WorkspaceSwitchLink } from '@/components/nav/WorkspaceSwitchLink';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerActorOutcome, getServerSession } from '@/server/serverActor';
import { shellRedirect } from '@/server/shellGate';

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
  return children;
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
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] print:block">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      {/* usePathname() is runtime data: keep it out of the prerendered shell for dynamic routes. */}
      <Suspense fallback={null}>
        <CoachNav
          switcher={
            <Suspense fallback={null}>
              <WorkspaceSwitchLink />
            </Suspense>
          }
        />
      </Suspense>
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-divider bg-surface px-4 py-2 md:hidden print:hidden">
          <p className="text-lg font-semibold">Kinetic</p>
          <Suspense fallback={null}>
            <WorkspaceSwitchLink className="text-sm" />
          </Suspense>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-8"
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
