'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { LIFECYCLE_STAGES, STAGE_LABEL } from '@repsy/core/client-stages';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type {
  AdherenceCounts,
  ClientCompliance,
  ClientView,
  StateBucket,
  TagView,
} from '@repsy/core';
import { TagBadge } from '@/components/tags/TagBadge';
import { CompliancePercent } from '@/components/analytics/Compliance';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { WeekDots } from '@/components/charts/WeekDots';
import type { SessionStateKey } from '@/components/charts/palette';
import { EmptyState } from '@/components/states/EmptyState';
import { Avatar } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { dayMonth, weekdayShort } from '@/lib/relative-time';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BulkActions, type BulkTemplate } from './BulkActions';
import { StatusBadge } from './StatusBadge';

const SEARCH_DEBOUNCE_MS = 300;

export interface ClientExtras {
  program: string | null;
  lastWorkout: string | null;
  nextWorkout: string | null;
  /** Last 28 days, 0-100, or null when nothing was due. */
  adherencePct: number | null;
  week: Array<{ localDate: string; state: StateBucket | null }>;
  unread: number;
}

const toneFor = (p: number): 'success' | 'warning' | 'danger' =>
  p >= 80 ? 'success' : p >= 50 ? 'warning' : 'danger';

/** Adherence for one window: a small bar plus the figure (which keeps the "No sessions due yet" text). */
function AdherenceCell({
  counts,
  name,
  days,
}: {
  counts: AdherenceCounts;
  name: string;
  days: number;
}) {
  return (
    <div className="flex min-w-24 flex-col items-end gap-1">
      <CompliancePercent counts={counts} />
      {counts.eligible > 0 && (
        <Progress
          size="sm"
          className="w-16"
          value={counts.completed}
          max={counts.eligible}
          label={`${name}, adherence ${days} days`}
          valueText={`${counts.completed} of ${counts.eligible}`}
          tone={toneFor((counts.completed / counts.eligible) * 100)}
        />
      )}
    </div>
  );
}

const dots = (week: ClientExtras['week']) =>
  week.map((d) => ({
    label: weekdayShort(d.localDate),
    state: (d.state ?? 'rest') as SessionStateKey | 'rest',
  }));

function hrefFor(
  pathname: string,
  params: {
    q?: string;
    status?: string;
    tag?: string;
    stage?: string;
    cursor?: string | null;
    view?: string;
  },
): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.tag) sp.set('tag', params.tag);
  if (params.stage) sp.set('stage', params.stage);
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.view === 'grid') sp.set('view', 'grid');
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function ClientsTable({
  items,
  compliance,
  tags,
  clientTags,
  tag,
  nextCursor,
  q,
  status,
  stage = '',
  coachNames = {},
  hasCursor,
  templates = [],
  extras = {},
  view = 'list',
}: {
  /** Program, last / next workout, the week and unread messages per client id. */
  extras?: Record<string, ClientExtras>;
  view?: 'list' | 'grid';
  items: ClientView[];
  /** Saved templates, for bulk assign (PRD B5). */
  templates?: BulkTemplate[];
  /** Rolling adherence per client id (PRD I5); a client with no entry shows no figures. */
  compliance: Record<string, ClientCompliance>;
  /** The workspace's tags, for the filter (PRD B4). */
  tags: TagView[];
  /** Tags per client id. */
  clientTags: Record<string, TagView[]>;
  /** The selected tag filter ('' = all). */
  tag: string;
  nextCursor: string | null;
  q: string;
  status: string;
  /** PRD B20: the selected lifecycle stage ('' = all). */
  stage?: string;
  /** PRD A11: primary coach names, when the workspace has a team. */
  coachNames?: Record<string, string>;
  hasCursor: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const lastPushed = useRef(q);
  // PRD B5: selection on this page, for bulk actions.
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  const picked = items.filter((c) => selected.includes(c.id));
  const allOnPage = items.length > 0 && items.every((c) => selected.includes(c.id));

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
      startTransition(() =>
        router.replace(hrefFor(pathname, { q: search.trim(), status, tag, stage, view })),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, status, tag, stage, view, pathname, router]);

  const selectClass =
    'min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';
  const th = 'label-micro px-4 py-3 text-secondary';
  const go = (p: { tag?: string; stage?: string }) =>
    startTransition(() => router.replace(hrefFor(pathname, { q, status, tag, stage, view, ...p })));
  const Name = ({ c }: { c: ClientView }) => (
    <span className="inline-flex items-center gap-1.5">
      {c.name}
      {(extras[c.id]?.unread ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-accent">
          <span aria-hidden className="size-2 rounded-full bg-ember" />
          <span className="sr-only">,</span>
          {extras[c.id]!.unread} unread
        </span>
      )}
    </span>
  );

  return (
    <div className={cn('flex flex-col gap-4', pending && 'opacity-70')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative sm:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-secondary"
          />
          <Input
            type="search"
            aria-label="Search clients"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by stage"
          value={stage}
          onChange={(e) => go({ stage: e.target.value })}
          className={selectClass}
        >
          <option value="">All stages</option>
          {LIFECYCLE_STAGES.map((st) => (
            <option key={st} value={st}>
              {STAGE_LABEL[st]}
            </option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            aria-label="Filter by tag"
            value={tag}
            onChange={(e) => go({ tag: e.target.value })}
            className={selectClass}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {picked.length > 0 && (
        <BulkActions
          selected={picked.map((c) => ({ id: c.id, name: c.name }))}
          tags={tags}
          templates={templates}
          onClear={() => setSelected([])}
        />
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No clients match"
          body="Try a different search or filter."
          action={
            <Link href={pathname} className={buttonVariants({ variant: 'secondary' })}>
              Clear filters
            </Link>
          }
        />
      ) : view === 'grid' ? (
        <ul aria-label="Clients" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => {
            const x = extras[c.id];
            return (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-e1"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${c.name}`}
                    className="mt-1 size-5 shrink-0 accent-accent"
                    checked={selected.includes(c.id)}
                    onChange={(e) => toggle(c.id, e.target.checked)}
                  />
                  <Avatar name={c.name} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/clients/${c.id}`}
                      className="font-semibold hover:text-accent hover:underline"
                    >
                      <Name c={c} />
                    </Link>
                    <p className="truncate text-sm text-secondary">{c.email}</p>
                  </div>
                  <ProgressRing value={x?.adherencePct ?? null} size={52} stroke={6} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={c.status} inviteStatus={c.inviteStatus} />
                  <span className="text-caption text-secondary">
                    {STAGE_LABEL[c.lifecycleStage]}
                  </span>
                </div>
                <p className="text-sm">
                  <span className="text-secondary">Program: </span>
                  {x?.program ?? 'None assigned'}
                </p>
                {x && x.week.length > 0 && <WeekDots days={dots(x.week)} />}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                  <Link
                    href={`/app/clients/${c.id}/messages`}
                    className={buttonVariants({ variant: 'soft', size: 'sm' })}
                  >
                    Message<span className="sr-only"> {c.name}</span>
                  </Link>
                  <Link
                    href={`/app/clients/${c.id}/program`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    Program<span className="sr-only"> for {c.name}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div className="relative hidden overflow-x-auto rounded-card border border-border bg-surface shadow-e1 md:block">
            <table className="w-full text-left text-body">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  <th scope="col" className={cn(th, 'w-12')}>
                    <input
                      type="checkbox"
                      aria-label="Select all clients on this page"
                      className="size-4 accent-accent"
                      checked={allOnPage}
                      onChange={(e) => setSelected(e.target.checked ? items.map((c) => c.id) : [])}
                    />
                  </th>
                  <th scope="col" className={th}>
                    Client
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                  <th scope="col" className={th}>
                    Program
                  </th>
                  <th scope="col" className={th}>
                    Last / next
                  </th>
                  {(
                    [
                      ['7d', 'Adherence, last 7 days'],
                      ['30d', 'Adherence, last 30 days'],
                      ['90d', 'Adherence, last 90 days'],
                    ] as const
                  ).map(([short, long]) => (
                    <th key={short} scope="col" className={cn(th, 'text-right')}>
                      <abbr title={long} className="no-underline">
                        {short}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const on = selected.includes(c.id);
                  const x = extras[c.id];
                  return (
                    <tr
                      key={c.id}
                      className={cn(
                        'border-t border-border transition-colors hover:bg-surface-2/60',
                        on && 'bg-accent-soft/50',
                      )}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          className="size-4 accent-accent"
                          checked={on}
                          onChange={(e) => toggle(c.id, e.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <Link
                              href={`/app/clients/${c.id}`}
                              className="font-medium whitespace-nowrap hover:text-accent hover:underline"
                            >
                              <Name c={c} />
                            </Link>
                            <p className="text-sm text-secondary [overflow-wrap:anywhere]">
                              {c.email}
                            </p>
                            {clientTags[c.id] && (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {clientTags[c.id]!.map((t) => (
                                  <TagBadge key={t.id} tag={t} />
                                ))}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} inviteStatus={c.inviteStatus} />
                        <span className="mt-1 block text-caption text-secondary">
                          {STAGE_LABEL[c.lifecycleStage]}
                          {coachNames[c.coachUserId] && ` · ${coachNames[c.coachUserId]}`}
                        </span>
                      </td>
                      <td className="max-w-48 px-4 py-3 text-sm">
                        {x?.program ?? <span className="text-secondary">None</span>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <span className="block">
                          <span className="text-secondary">Last </span>
                          {x?.lastWorkout ? dayMonth(x.lastWorkout) : '–'}
                        </span>
                        <span className="block">
                          <span className="text-secondary">Next </span>
                          {x?.nextWorkout ? dayMonth(x.nextWorkout) : '–'}
                        </span>
                      </td>
                      {([7, 30, 90] as const).map((days) => {
                        const counts = compliance[c.id]?.[days];
                        return (
                          <td key={days} className="px-4 py-3 text-right">
                            {counts && <AdherenceCell counts={counts} name={c.name} days={days} />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden" aria-label="Clients">
            {items.map((c) => {
              const x = extras[c.id];
              return (
                <li
                  key={c.id}
                  className="rounded-card border border-border bg-surface p-4 shadow-e1"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      className="size-5 shrink-0 accent-accent"
                      checked={selected.includes(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/clients/${c.id}`}
                        className="inline-flex min-h-6 items-center font-semibold hover:underline"
                      >
                        <Name c={c} />
                      </Link>
                      <p className="text-sm break-all text-secondary">{c.email}</p>
                    </div>
                    <ProgressRing value={x?.adherencePct ?? null} size={44} stroke={5} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge status={c.status} inviteStatus={c.inviteStatus} />
                    <span className="text-caption text-secondary">
                      {STAGE_LABEL[c.lifecycleStage]}
                      {x?.program && ` · ${x.program}`}
                    </span>
                    {clientTags[c.id]?.map((t) => (
                      <TagBadge key={t.id} tag={t} />
                    ))}
                  </div>
                  {compliance[c.id] && (
                    <dl className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                      {([7, 30, 90] as const).map((days) => (
                        <div key={days}>
                          <dt className="label-micro text-secondary">{days} days</dt>
                          <dd>
                            <CompliancePercent counts={compliance[c.id]![days]} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(hasCursor || nextCursor) && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {hasCursor ? (
            <Link
              href={hrefFor(pathname, { q, status, tag, stage, view })}
              className={buttonVariants({ variant: 'secondary' })}
            >
              First page
            </Link>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Link
              href={hrefFor(pathname, { q, status, tag, stage, view, cursor: nextCursor })}
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
