import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerSession } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

async function AdminGate({ children }: { children: ReactNode }) {
  const { user } = await getServerSession();
  // Invisible to everyone but platform admins (src/proxy.ts answers 404 too).
  if (!user?.isPlatformAdmin) notFound();
  return children;
}

/** The platform-admin console (S5-3). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <Suspense fallback={<LoadingState />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </main>
  );
}
