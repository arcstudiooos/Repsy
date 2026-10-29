import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/EmptyState';

export const metadata: Metadata = { title: 'Home | Kinetic' };

// Access is enforced by src/proxy.ts (signed in, verified); portal membership checks land in Sprint 1.
export default function PortalHome() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Home</h1>
      <EmptyState
        title="Nothing scheduled yet"
        body="Your workouts and check-ins will show up here once your coach assigns them."
      />
    </>
  );
}
