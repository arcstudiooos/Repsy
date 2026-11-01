import type { Metadata } from 'next';
import Link from 'next/link';
import {
  clientCompliance,
  DomainError,
  listClients,
  listTags,
  tagsForClients,
  type ClientCompliance,
  type TagView,
  type ClientStatus,
} from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ClientsTable } from './ClientsTable';
import { NewClientDialog } from './NewClientDialog';

export const metadata: Metadata = { title: 'Clients | Kinetic' };

const STATUSES: ClientStatus[] = ['invited', 'active', 'paused', 'archived'];

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

function ImportLink() {
  return (
    <Button asChild variant="secondary">
      <Link href="/app/clients/import">Import from CSV</Link>
    </Button>
  );
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = first(sp.q)?.trim().slice(0, 100) || undefined;
  const statusParam = first(sp.status);
  const status = STATUSES.find((s) => s === statusParam);
  const cursor = first(sp.cursor);
  const tagParam = first(sp.tag);

  let result: Awaited<ReturnType<typeof listClients>>;
  let compliance: Record<string, ClientCompliance>;
  let tags: TagView[];
  let clientTags: Record<string, TagView[]>;
  let tagId: string | undefined;
  let templates: { id: string; title: string; daysPerWeek: number }[];
  try {
    ({ result, compliance, tags, clientTags, tagId, templates } = await withServerTenant(
      async (tx, actor) => {
        const all = await listTags(tx, actor);
        const tagId = all.find((t) => t.id === tagParam)?.id;
        const list = await listClients(tx, actor, { q, status, cursor, tagId });
        const byClient = await clientCompliance(
          tx,
          actor,
          list.items.map((c) => c.id),
        );
        const ids = list.items.map((c) => c.id);
        return {
          result: list,
          compliance: Object.fromEntries(byClient),
          tags: all.map(({ id, name, color }) => ({ id, name, color })),
          clientTags: Object.fromEntries(await tagsForClients(tx, actor, ids)),
          tagId,
          // PRD B5: saved templates for bulk assign.
          templates: (await loadAllTemplates(tx, actor)).items.flatMap((p) =>
            p.versionNo !== null && p.daysPerWeek
              ? [{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]
              : [],
          ),
        };
      },
    ));
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Clients</h1>
          <ErrorState message="That page link is no longer valid. Go back to the first page." />
        </>
      );
    }
    throw error;
  }

  const filtered = q !== undefined || status !== undefined || tagId !== undefined;
  const isEmptyRoster = result.items.length === 0 && !filtered && cursor === undefined;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Clients</h1>
        {!isEmptyRoster && (
          <div className="flex flex-wrap gap-3">
            <ImportLink />
            <NewClientDialog />
          </div>
        )}
      </div>
      {isEmptyRoster ? (
        <EmptyState
          title="Add your first client"
          body="Invite a client by email. They will get a link to set up their account. Moving from another app? Import your roster from a CSV file."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <NewClientDialog />
              <ImportLink />
            </div>
          }
        />
      ) : (
        <ClientsTable
          items={result.items}
          compliance={compliance}
          tags={tags}
          clientTags={clientTags}
          tag={tagId ?? ''}
          nextCursor={result.nextCursor}
          q={q ?? ''}
          status={status ?? ''}
          hasCursor={cursor !== undefined}
          templates={templates}
        />
      )}
    </>
  );
}
