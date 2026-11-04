import type { Metadata } from 'next';
import { listResources } from '@kinetic/core';
import { ResourceList } from '@/components/resources/ResourceList';
import { EmptyState } from '@/components/states/EmptyState';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Resources | Repsy' };

/** Links and notes your coach shared with you (PRD G5). */
export default async function PortalResourcesPage() {
  const items = await withPortalTenant((tx, actor) => listResources(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Resources</h1>
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
