import type { Metadata } from 'next';
import { PilotCodeForm } from './PilotCodeForm';

export const metadata: Metadata = { title: 'Pilot code | Repsy' };

// Session + verified email are enforced by src/proxy.ts and the server action.
export default function PilotCodePage() {
  return <PilotCodeForm />;
}
