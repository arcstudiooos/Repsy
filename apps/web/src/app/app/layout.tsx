import type { ReactNode } from 'react';
import { CoachShell } from '@/components/nav/CoachShell';
import { ONBOARDING_PATH } from '@/lib/membership';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

/** Coach shell for /app; the shell enforces an active owner/coach membership. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CoachShell loginNext="/app" noMembershipPath={ONBOARDING_PATH}>
      {children}
    </CoachShell>
  );
}
