'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { ClientView } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatDate, StatusBadge } from './StatusBadge';

const SEARCH_DEBOUNCE_MS = 300;

function hrefFor(
  pathname: string,
  params: { q?: string; status?: string; cursor?: string | null },
): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.cursor) sp.set('cursor', params.cursor);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function ClientsTable({
  items,
  nextCursor,
  q,
  status,
  hasCursor,
}: {
  items: ClientView[];
  nextCursor: string | null;
  q: string;
  status: string;
  hasCursor: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const lastPushed = useRef(q);

  // The URL changed from outside (Clear filters, back/forward): resync the input and the
  // debounce baseline. Our own pushes set lastPushed first, so they never trigger this.
  useEffect(() => {
    if (q === lastPushed.current) return;
    lastPushed.current = q;
    setSearch(q);
  }, [q]);

  // Debounced search: update the URL (and so the server-rendered list) 300ms after typing stops.
  useEffect(() => {
    if (search.trim() === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = search.trim();
      startTransition(() => router.replace(hrefFor(pathname, { q: search.trim(), status })));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, status, pathname, router]);

  return (
    <div className={cn('flex flex-col gap-4', pending && 'opacity-70')}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="search"
          aria-label="Search clients"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) =>
            startTransition(() => router.replace(hrefFor(pathname, { q, status: e.target.value })))
          }
          className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          <option value="">All statuses</option>
          <option value="invited">Invited</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No clients match"
          body="Try a different search or status filter."
          action={
            <Link href={pathname} className={buttonVariants({ variant: 'secondary' })}>
              Clear filters
            </Link>
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card bg-surface shadow-card md:block">
            <table className="w-full text-left text-base">
              <thead className="border-b border-divider text-sm text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Start date
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-divider last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link
                        href={`/app/clients/${c.id}`}
                        className="inline-flex min-h-11 items-center font-medium underline-offset-2 hover:underline md:min-h-6"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 [overflow-wrap:anywhere]">{c.email}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={c.status} inviteStatus={c.inviteStatus} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(c.startDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden" aria-label="Clients">
            {items.map((c) => (
              <li key={c.id} className="rounded-card bg-surface p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/app/clients/${c.id}`}
                    className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <StatusBadge status={c.status} inviteStatus={c.inviteStatus} />
                </div>
                <p className="text-sm break-all text-secondary">{c.email}</p>
                <p className="mt-1 text-sm text-secondary">Start date: {formatDate(c.startDate)}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {(hasCursor || nextCursor) && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {hasCursor ? (
            <Link
              href={hrefFor(pathname, { q, status })}
              className={buttonVariants({ variant: 'secondary' })}
            >
              First page
            </Link>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Link
              href={hrefFor(pathname, { q, status, cursor: nextCursor })}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
