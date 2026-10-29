import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { prisma } from '@kinetic/db';
import { CoachNav } from '@/components/nav/CoachNav';
import { PathBreadcrumbs } from '@/components/nav/PathBreadcrumbs';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { hasCoachMembership } from '@/lib/membership';

/** Defense in depth behind src/proxy.ts: needs a verified user with an active owner/coach membership. */
async function MembershipGate({
  children,
  loginNext,
  noMembershipPath,
}: {
  children: ReactNode;
  loginNext: string;
  noMembershipPath: string;
}) {
  const user = await getSessionUser(await headers());
  if (!user) redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  if (!user.emailVerified) redirect('/verify-email');
  if (!(await hasCoachMembership(prisma, user.id))) redirect(noMembershipPath);
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
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      {/* usePathname() is runtime data: keep it out of the prerendered shell for dynamic routes. */}
      <Suspense fallback={null}>
        <CoachNav />
      </Suspense>
      <div className="flex min-w-0 flex-col">
        <header className="border-b border-divider bg-surface px-4 py-3 md:hidden">
          <p className="text-lg font-semibold">Kinetic</p>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-8"
        >
          <Suspense fallback={null}>
            <PathBreadcrumbs />
          </Suspense>
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
