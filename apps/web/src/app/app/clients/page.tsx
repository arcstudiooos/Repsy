import type { Metadata } from 'next';
import { DomainError, listClients, type ClientStatus } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { withServerTenant } from '@/server/serverActor';
import { ClientsTable } from './ClientsTable';
import { NewClientDialog } from './NewClientDialog';

export const metadata: Metadata = { title: 'Clients | Kinetic' };

const STATUSES: ClientStatus[] = ['invited', 'active', 'paused', 'archived'];

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

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

  let result: Awaited<ReturnType<typeof listClients>>;
  try {
    result = await withServerTenant((tx, actor) => listClients(tx, actor, { q, status, cursor }));
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

  const filtered = q !== undefined || status !== undefined;
  const isEmptyRoster = result.items.length === 0 && !filtered && cursor === undefined;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Clients</h1>
        {!isEmptyRoster && <NewClientDialog />}
      </div>
      {isEmptyRoster ? (
        <EmptyState
          title="Add your first client"
          body="Invite a client by email. They will get a link to set up their account."
          action={<NewClientDialog />}
        />
      ) : (
        <ClientsTable
          items={result.items}
          nextCursor={result.nextCursor}
          q={q ?? ''}
          status={status ?? ''}
          hasCursor={cursor !== undefined}
        />
      )}
    </>
  );
}
