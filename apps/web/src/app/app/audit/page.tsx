import type { Metadata } from 'next';
import Link from 'next/link';
import { AUDIT_CATEGORIES, isManager, listAuditLog, type AuditCategory } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Audit log | Repsy' };

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  all: 'All',
  assignments: 'Assignments',
  clients: 'Clients and invites',
  programs: 'Programs',
  data: 'Exports and deletions',
  access: 'Access and settings',
};
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** PRD A14: the owner's content-free record of who did what and when. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const category = (AUDIT_CATEGORIES as readonly string[]).includes(first(sp.category) ?? '')
    ? (first(sp.category) as AuditCategory)
    : 'all';
  const cursor = first(sp.cursor);
  const result = await withServerTenant(async (tx, actor) =>
    isManager(actor.role) ? listAuditLog(tx, actor, { category, cursor }) : null,
  );
  const href = (c: AuditCategory, next?: string | null) => {
    const q = new URLSearchParams();
    if (c !== 'all') q.set('category', c);
    if (next) q.set('cursor', next);
    const s = q.toString();
    return s ? `/app/audit?${s}` : '/app/audit';
  };
  return (
    <>
      <h1 className="mb-2 text-h1 font-semibold md:text-display">Audit log</h1>
      <p className="mb-6 text-secondary">
        Who did what and when in this workspace. It never shows messages, notes or answers.
      </p>
      {!result ? (
        <p className="text-secondary">
          Only the workspace owner or an admin can see the audit log.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <nav aria-label="Filter the log" className="flex flex-wrap gap-2">
            {AUDIT_CATEGORIES.map((c) => (
              <Link
                key={c}
                href={href(c)}
                aria-current={c === category ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: c === category ? 'default' : 'secondary', size: 'sm' }),
                  'min-h-11',
                )}
              >
                {CATEGORY_LABEL[c]}
              </Link>
            ))}
          </nav>
          {result.items.length === 0 ? (
            <EmptyState title="Nothing here yet" body="Changes show up here as people make them." />
          ) : (
            <ol
              aria-label="Audit events"
              className="flex flex-col divide-y divide-divider rounded-card bg-surface shadow-card"
            >
              {result.items.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col gap-1 p-3 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <time dateTime={e.at} className="shrink-0 text-sm text-secondary sm:w-44">
                    {when(e.at)}
                  </time>
                  <p className="min-w-0">
                    <span className="font-medium">{e.actorName ?? 'Repsy'}</span> · {e.label}
                    {e.clientName && <span className="text-secondary"> · {e.clientName}</span>}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {(cursor || result.nextCursor) && (
            <nav aria-label="Pagination" className="flex justify-between gap-3">
              {cursor ? (
                <Link href={href(category)} className={buttonVariants({ variant: 'secondary' })}>
                  Newest
                </Link>
              ) : (
                <span />
              )}
              {result.nextCursor && (
                <Link
                  href={href(category, result.nextCursor)}
                  className={buttonVariants({ variant: 'secondary' })}
                >
                  Older
                </Link>
              )}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
