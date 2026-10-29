import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { prisma } from '@kinetic/db';
import { CoachNav } from '@/components/nav/CoachNav';
import { PathBreadcrumbs } from '@/components/nav/PathBreadcrumbs';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { hasCoachMembership, ONBOARDING_PATH } from '@/lib/membership';

/** Defense in depth behind src/proxy.ts: /app needs an active owner/coach membership. */
async function MembershipGate({ children }: { children: ReactNode }) {
  const user = await getSessionUser(await headers());
  if (!user) redirect('/login?next=%2Fapp');
  if (!user.emailVerified) redirect('/verify-email');
  if (!(await hasCoachMembership(prisma, user.id))) redirect(ONBOARDING_PATH);
  return children;
}

/** Coach shell: left rail on desktop, bottom nav on mobile (375 / 768 / 1440). */
export default function AppLayout({ children }: { children: ReactNode }) {
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
            <MembershipGate>{children}</MembershipGate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
