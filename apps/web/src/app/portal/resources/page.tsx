import type { Metadata } from 'next';
import { listResources } from '@kinetic/core';
import { ResourceList } from '@/components/resources/ResourceList';
import { EmptyState } from '@/components/states/EmptyState';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Resources | Kinetic' };

/** Links and notes your coach shared with you (PRD G5). */
export default async function PortalResourcesPage() {
  const items = await withPortalTenant((tx, actor) => listResources(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Resources</h1>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Links and notes your coach shares appear here."
        />
      ) : (
        <ResourceList items={items} canRemove={false} />
      )}
    </>
  );
}
