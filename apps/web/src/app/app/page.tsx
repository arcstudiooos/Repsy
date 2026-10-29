import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/EmptyState';

export const metadata: Metadata = { title: 'Dashboard | Kinetic' };

// Access is enforced by src/proxy.ts and the membership gate in layout.tsx.
export default function AppHome() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Coach dashboard</h1>
      <EmptyState
        title="Nothing to review yet"
        body="Clients, check-ins and workouts will show up here as you add them."
      />
    </>
  );
}
