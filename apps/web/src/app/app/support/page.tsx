import type { Metadata } from 'next';
import { SupportPage } from '@/components/support/SupportPage';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Help and support | Repsy' };

export default function CoachSupport() {
  return <SupportPage coach />;
}
