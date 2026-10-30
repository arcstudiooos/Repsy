import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { PortalNav } from '@/components/nav/PortalNav';
import { WorkspaceSwitchLink } from '@/components/nav/WorkspaceSwitchLink';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerActorOutcome, getServerSession, withServerTenant } from '@/server/serverActor';
import { shellRedirect } from '@/server/shellGate';

/**
 * Portal gate (behind src/proxy.ts, which checks session + verified email):
 * the active org must give this user a `client` role AND a linked Client row.
 * Mirrors the coach shell: a coach role in the active org goes to /app; no chosen or a stale active org goes to
 * /select-org; no workspace at all goes to `/`.
 */
async function ClientGate({ children }: { children: ReactNode }) {
  const { user } = await getServerSession();
  if (!user) redirect('/login?next=%2Fportal');
  const target = shellRedirect('portal', await getServerActorOutcome(user));
  if (target) redirect(target);
  const linked = await withServerTenant((tx, actor) =>
    tx.client.findFirst({ where: { userId: actor.userId }, select: { id: true } }),
  );
  // A client membership without a Client row is a data fault; redirecting to `/`
  // would loop straight back here, so say so instead.
  if (!linked) {
    return (
      <EmptyState
        title="Your profile isn't ready"
        body="We couldn't find your client profile. Ask your coach to send a new invite."
      />
    );
  }
  return children;
}

/** Client portal shell: bottom tab bar on mobile, top bar from 768px up. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="border-b border-divider bg-surface px-4 py-2 md:border-b-0 md:pb-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 md:px-8">
          <p className="text-lg font-semibold">Kinetic</p>
          <Suspense fallback={null}>
            <WorkspaceSwitchLink className="text-sm" />
          </Suspense>
        </div>
      </header>
      <PortalNav />
      <main
        id="main"
        className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-8"
      >
        <Suspense fallback={<LoadingState />}>
          <ClientGate>{children}</ClientGate>
        </Suspense>
      </main>
    </div>
  );
}
