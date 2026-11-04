import type { Metadata } from 'next';
import { listResources, listTags } from '@kinetic/core';
import { NewResourceForm } from '@/components/resources/NewResourceForm';
import { ResourceList } from '@/components/resources/ResourceList';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadActiveClients } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Resources | Repsy' };

/** The coach's resource library (PRD G5): links and short texts shared with all clients, a tag or one client. */
export default async function ResourcesPage() {
  const { items, tags, clients } = await withServerTenant(async (tx, actor) => ({
    items: await listResources(tx, actor),
    tags: (await listTags(tx, actor)).map((t) => ({ id: t.id, name: t.name })),
    clients: (await loadActiveClients(tx, actor)).items.map((c) => ({ id: c.id, name: c.name })),
  }));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Resources</h1>
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Share a resource</CardTitle>
            <CardDescription>
              A link (a video, an article, a shopping list) or a short text. Clients find it under
              Resources in their portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewResourceForm tags={tags} clients={clients} />
          </CardContent>
        </Card>
        {items.length === 0 ? (
          <EmptyState title="No resources yet" body="Share your first one above." />
        ) : (
          <ResourceList items={items} canRemove />
        )}
      </div>
    </>
  );
}
