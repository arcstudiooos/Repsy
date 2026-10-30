import type { Metadata } from 'next';
import Link from 'next/link';
import { DomainError, listPrograms } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';
import { NewProgramDialog } from './NewProgramDialog';

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

  let result: Awaited<ReturnType<typeof listPrograms>>;
  try {
    result = await withServerTenant((tx, actor) =>
      listPrograms(tx, actor, { kind: 'template', cursor }),
    );
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

  const isEmpty = result.items.length === 0 && cursor === undefined;

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
      {isEmpty ? (
        <EmptyState
          title="Create your first program"
          body="Build a reusable template with weeks, training days and exercises, then assign it to clients."
          action={<NewProgramDialog />}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Programs">
          {result.items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/programs/${p.id}/edit`}
                className="flex min-h-11 flex-col gap-1 rounded-card bg-surface p-4 shadow-card hover:bg-canvas"
              >
                <span className="text-base font-semibold">{p.title}</span>
                <span className="text-sm text-secondary">
                  {p.versionNo === null
                    ? 'Not saved yet'
                    : `${plural(p.weekCount ?? 0, 'week', 'weeks')} · ${plural(p.daysPerWeek ?? 0, 'day', 'days')} per week · Version ${p.versionNo}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(cursor !== undefined || result.nextCursor) && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
          {cursor !== undefined ? (
            <Link href="/app/programs" className={buttonVariants({ variant: 'secondary' })}>
              First page
            </Link>
          ) : (
            <span />
          )}
          {result.nextCursor && (
            <Link
              href={`/app/programs?cursor=${encodeURIComponent(result.nextCursor)}`}
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
