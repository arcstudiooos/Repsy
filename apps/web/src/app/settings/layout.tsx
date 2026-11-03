import type { ReactNode } from 'react';
import { CoachShell } from '@/components/nav/CoachShell';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

/**
 * Settings use the coach shell. Signed-in users without a coach membership
 * (clients) go to `/`, which routes them by role.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <CoachShell loginNext="/settings" noMembershipPath="/">
      {children}
    </CoachShell>
  );
}
