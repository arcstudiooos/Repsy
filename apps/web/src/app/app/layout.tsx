import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { prisma } from '@kinetic/db';
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

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <MembershipGate>{children}</MembershipGate>
    </Suspense>
  );
}
