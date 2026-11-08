import type { Metadata } from 'next';
import Link from 'next/link';
import { Dumbbell, Users } from 'lucide-react';
import { AvatarStack } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { DomainError, listPrograms } from '@repsy/core';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadActiveClients } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { AssignDialog } from '../clients/[id]/program/AssignDialog';
import { NewProgramDialog } from './NewProgramDialog';
import { ProgramActions } from './ProgramActions';

export const metadata: Metadata = { title: 'Programs | Repsy' };

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const seg = 'inline-flex min-h-9 items-center rounded-[6px] px-3 text-sm font-medium';
const segOn = 'bg-surface text-ink shadow-sm';
const segOff = 'text-secondary hover:text-ink';

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
  let usersOf: Record<string, string[]> = {};
  let clientOptions: Awaited<ReturnType<typeof loadActiveClients>>;
  try {
    [result, clientOptions, usersOf] = await withServerTenant(async (tx, actor) => {
      const list = await listPrograms(tx, actor, { kind: 'template', cursor, q, status });
      // Who runs each template now: active assignments run client copies whose source is the template.
      const running = await tx.programAssignment.findMany({
        where: {
          status: 'active',
          program: { sourceProgramId: { in: list.items.map((p) => p.id) } },
        },
        select: {
          client: { select: { name: true } },
          program: { select: { sourceProgramId: true } },
        },
      });
      const names: Record<string, string[]> = {};
      for (const r of running) {
        const t = r.program.sourceProgramId;
        if (t) (names[t] ??= []).push(r.client.name);
      }
      return [list, await loadActiveClients(tx, actor), names] as const;
    });
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-h1 font-semibold md:text-display">Programs</h1>
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between md:mb-8">
        <div>
          <h1 className="text-h1 font-semibold md:text-display">Programs</h1>
          <p className="mt-1 text-secondary">
            Reusable templates. Edits never change a client&apos;s own copy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/exercises" className={buttonVariants({ variant: 'secondary' })}>
            Exercise library
          </Link>
          {!isEmpty && (
            <div className="flex flex-wrap gap-3">
              <Link
                href="/app/programs/import"
                className={buttonVariants({ variant: 'secondary' })}
              >
                Import from text
              </Link>
              <NewProgramDialog />
            </div>
          )}
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
          <nav
            aria-label="Program status"
            className="inline-flex w-fit gap-1 rounded-control bg-surface-2 p-1"
          >
            <Link
              href={qs({ status: undefined })}
              aria-current={archived ? undefined : 'page'}
              className={cn(seg, archived ? segOff : segOn)}
            >
              Active
            </Link>
            <Link
              href={qs({ status: 'archived' })}
              aria-current={archived ? 'page' : undefined}
              className={cn(seg, archived ? segOn : segOff)}
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
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <NewProgramDialog />
              <Link
                href="/app/programs/import"
                className={buttonVariants({ variant: 'secondary' })}
              >
                Import from text
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Programs">
          {result.items.map((p) => (
            <li
              key={p.id}
              className="flex flex-col rounded-card border border-border bg-surface shadow-e1 transition-shadow duration-[var(--k-motion-fast)] hover:shadow-e2"
            >
              <div className="flex flex-1 gap-3 p-4 sm:p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-ink">
                  <Dumbbell aria-hidden className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/app/programs/${p.id}/edit`}
                    className="text-base font-semibold break-words hover:text-accent-ink hover:underline"
                  >
                    {p.title}
                  </Link>
                  {p.house && (
                    <span className="w-fit rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-secondary">
                      House
                    </span>
                  )}
                  <span className="text-sm text-secondary">
                    {p.versionNo === null
                      ? 'Not saved yet'
                      : `${plural(p.weekCount ?? 0, 'week', 'weeks')} · ${plural(p.daysPerWeek ?? 0, 'day', 'days')} per week · Version ${p.versionNo}`}
                  </span>
                  {/* Read-only usage (D-001 #7): edits to a template never reach the clients' own copies. */}
                  <span
                    className={cn(
                      'mt-1 flex items-center gap-1.5 text-sm',
                      p.activeClientCount === 0 ? 'text-secondary' : 'text-ink',
                    )}
                  >
                    {(usersOf[p.id]?.length ?? 0) > 0 ? (
                      <AvatarStack
                        names={usersOf[p.id]!}
                        max={4}
                        label={`Run by ${usersOf[p.id]!.join(', ')}`}
                      />
                    ) : (
                      <Users aria-hidden className="size-4 text-secondary" />
                    )}
                    {p.activeClientCount === 0
                      ? 'Not assigned'
                      : `Used by ${plural(p.activeClientCount, 'client', 'clients')}`}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-divider px-4 py-3 sm:px-5">
                {!archived && p.versionNo !== null && p.daysPerWeek && clients.length > 0 && (
                  <AssignDialog
                    fixed="template"
                    templates={[{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]}
                    clients={clients}
                    capped={clientOptions.capped}
                    triggerLabel="Assign"
                    triggerAriaLabel={`Assign ${p.title}`}
                    triggerVariant="soft"
                  />
                )}
                <ProgramActions id={p.id} title={p.title} archived={archived} />
              </div>
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
