import type { Metadata } from 'next';
import { connection } from 'next/server';
import { isManager, listLocations, listStaffLocations } from '@repsy/core';
import { LocationsManager } from '@/components/classes/LocationsManager';
import { EmptyState } from '@/components/states/EmptyState';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Locations | Repsy' };

/** PRD A15: owners and admins manage the workspace's sites. */
export default async function LocationsPage() {
  await connection();
  const data = await withServerTenant(async (tx, actor) => {
    if (!isManager(actor.role)) return null;
    const all = await listLocations(tx, actor, { includeArchived: true });
    return {
      locations: all.filter((l) => !l.archived),
      archived: all.filter((l) => l.archived),
      staff: await listStaffLocations(tx, actor),
    };
  });
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Locations</h1>
      {data ? (
        <LocationsManager {...data} />
      ) : (
        <EmptyState
          title="Only owners and admins manage locations"
          body="Ask an owner or admin to add a location or move you to one."
        />
      )}
    </>
  );
}
