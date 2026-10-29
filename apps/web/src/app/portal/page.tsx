import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/EmptyState';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Home | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalHome() {
  const org = await withServerTenant((tx, actor) =>
    tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }),
  );
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Home</h1>
      {org && <p className="mb-6 text-secondary">Coached by {org.name}</p>}
      <EmptyState
        title="Nothing scheduled yet"
        body="Your workouts and check-ins will show up here once your coach assigns them."
      />
    </>
  );
}
