import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { DomainError } from '@kinetic/core';
import { PortalNav } from '@/components/nav/PortalNav';
import { EmptyState } from '@/components/states/EmptyState';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerActor, withServerTenant } from '@/server/serverActor';

/**
 * Portal gate (behind src/proxy.ts, which checks session + verified email):
 * the active org must give this user a `client` role AND a linked Client row.
 * Anything else goes back to `/`, which routes by role (coaches to /app).
 */
async function ClientGate({ children }: { children: ReactNode }) {
  let isClient = false;
  try {
    isClient = (await getServerActor()).role === 'client';
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  if (!isClient) redirect('/');
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
      <header className="border-b border-divider bg-surface px-4 py-3 md:border-b-0 md:pb-0">
        <p className="mx-auto max-w-3xl text-lg font-semibold md:px-8">Kinetic</p>
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
