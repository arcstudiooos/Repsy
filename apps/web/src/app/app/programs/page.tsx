import type { Metadata } from 'next';
import Link from 'next/link';
import { DomainError, listPrograms } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadActiveClients } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { AssignDialog } from '../clients/[id]/program/AssignDialog';
import { NewProgramDialog } from './NewProgramDialog';
import { ProgramActions } from './ProgramActions';

export const metadata: Metadata = { title: 'Programs | Kinetic' };

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cursor = first(sp.cursor);
  const q = first(sp.q)?.trim().slice(0, 120) || undefined;
  const archived = first(sp.status) === 'archived';
  const status = archived ? ('archived' as const) : undefined;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/app/programs?${s}` : '/app/programs';
  };

  let result: Awaited<ReturnType<typeof listPrograms>>;
  let clientOptions: Awaited<ReturnType<typeof loadActiveClients>>;
  try {
    [result, clientOptions] = await withServerTenant(async (tx, actor) => [
      await listPrograms(tx, actor, { kind: 'template', cursor, q, status }),
      await loadActiveClients(tx, actor),
    ]);
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Programs</h1>
          <ErrorState message="That page link is no longer valid. Go back to the first page." />
        </>
      );
    }
    throw error;
  }

  const clients = clientOptions.items.map((c) => ({
    id: c.id,
    name: c.name,
    timezone: c.timezone,
  }));
  const filtered = q !== undefined || archived;
  const isEmpty = result.items.length === 0 && cursor === undefined && !filtered;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Programs</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app/exercises" className={buttonVariants({ variant: 'secondary' })}>
            Exercise library
          </Link>
          {!isEmpty && <NewProgramDialog />}
        </div>
      </div>
      {!isEmpty && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form role="search" action="/app/programs" className="flex gap-2 sm:max-w-md sm:flex-1">
            {archived && <input type="hidden" name="status" value="archived" />}
            <Input
              type="search"
              name="q"
              defaultValue={q ?? ''}
              aria-label="Search programs"
              placeholder="Search by title"
            />
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Search
            </button>
          </form>
          <nav aria-label="Program status" className="flex gap-2">
            <Link
              href={qs({ status: undefined })}
              aria-current={archived ? undefined : 'page'}
              className={buttonVariants({ variant: archived ? 'secondary' : 'default' })}
            >
              Active
            </Link>
            <Link
              href={qs({ status: 'archived' })}
              aria-current={archived ? 'page' : undefined}
              className={buttonVariants({ variant: archived ? 'default' : 'secondary' })}
            >
              Archived
            </Link>
          </nav>
        </div>
      )}
      {!isEmpty && result.items.length === 0 ? (
        <EmptyState
          title={archived ? 'No archived programs' : 'No programs match'}
          body={
            archived
              ? 'Archived programs show here. Clients already on them keep their program.'
              : 'Try a different search.'
          }
          action={
            <Link href="/app/programs" className={buttonVariants({ variant: 'secondary' })}>
              Show all programs
            </Link>
          }
        />
      ) : isEmpty ? (
        <EmptyState
          title="Create your first program"
          body="Build a reusable template with weeks, training days and exercises, then assign it to clients."
          action={<NewProgramDialog />}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Programs">
          {result.items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <Link
                href={`/app/programs/${p.id}/edit`}
                className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-card bg-surface p-4 shadow-card hover:bg-canvas"
              >
                <span className="text-base font-semibold">{p.title}</span>
                <span className="text-sm text-secondary">
                  {p.versionNo === null
                    ? 'Not saved yet'
                    : `${plural(p.weekCount ?? 0, 'week', 'weeks')} · ${plural(p.daysPerWeek ?? 0, 'day', 'days')} per week · Version ${p.versionNo}`}
                </span>
                {/* Read-only usage (D-001 #7): edits to a template never reach the clients' own copies. */}
                <span className="text-sm text-secondary">
                  {p.activeClientCount === 0
                    ? 'Not assigned'
                    : `Used by ${plural(p.activeClientCount, 'client', 'clients')}`}
                </span>
              </Link>
              <ProgramActions id={p.id} title={p.title} archived={archived} />
              {!archived && p.versionNo !== null && p.daysPerWeek && clients.length > 0 && (
                <AssignDialog
                  fixed="template"
                  templates={[{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]}
                  clients={clients}
                  capped={clientOptions.capped}
                  triggerLabel="Assign"
                  triggerAriaLabel={`Assign ${p.title}`}
                  triggerVariant="secondary"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {(cursor !== undefined || result.nextCursor) && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
          {cursor !== undefined ? (
            <Link href={qs({})} className={buttonVariants({ variant: 'secondary' })}>
              First page
            </Link>
          ) : (
            <span />
          )}
          {result.nextCursor && (
            <Link
              href={qs({ cursor: result.nextCursor })}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
