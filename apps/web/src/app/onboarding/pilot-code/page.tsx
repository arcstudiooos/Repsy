import type { Metadata } from 'next';
import { PilotCodeForm } from './PilotCodeForm';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Pilot code | Kinetic' };

// Session + verified email are enforced by src/proxy.ts and the server action.
export default function PilotCodePage() {
  return <PilotCodeForm />;
}
