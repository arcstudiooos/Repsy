import type { ReactNode } from 'react';
import { CoachShell } from '@/components/nav/CoachShell';
import { ONBOARDING_PATH } from '@/lib/membership';

/** Coach shell for /app; the shell enforces an active owner/coach membership. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CoachShell loginNext="/app" noMembershipPath={ONBOARDING_PATH}>
      {children}
    </CoachShell>
  );
}
