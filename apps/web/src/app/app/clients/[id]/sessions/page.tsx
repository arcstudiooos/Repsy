import type { Metadata } from 'next';
import Link from 'next/link';
import { bucketOf, isoWeekOf, listSessions, todayInZone, type SessionSummary } from '@kinetic/core';
import { weekdayShort } from '@/lib/relative-time';
import { STATE_COLOR } from '@/components/charts/palette';
import { sessionStateLabel } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/states/EmptyState';
import {
  ExtraWorkoutBadge,
  LoggedByCoachBadge,
  SessionStateBadge,
} from '@/components/sessions/SessionStateBadge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSessionDate, plural } from '@/lib/session-format';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Sessions | Repsy' };

function SessionList({
  title,
  items,
  clientId,
  today,
  action,
  more,
}: {
  title: string;
  items: SessionSummary[];
  clientId: string;
  today: string;
  action: string;
  more: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-secondary">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* The client's own calendar date, as the client sees it (Review Focus #1). */}
                  <span className="text-sm text-secondary">
                    {formatSessionDate(s.scheduledLocalDate, today)}
                  </span>
                  <span className="font-semibold break-words">{s.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                    {plural(s.exerciseCount, 'exercise', 'exercises')}
                    <SessionStateBadge state={s.state} overdue={s.overdue} />
                    {s.loggedByCoach && <LoggedByCoachBadge />}
                    {s.extra && <ExtraWorkoutBadge />}
                  </span>
                </div>
                <Link
                  href={`/app/clients/${clientId}/sessions/${s.id}`}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  aria-label={`${action}: ${s.title}, ${formatSessionDate(s.scheduledLocalDate, today)}`}
                >
                  {action}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {more && <p className="mt-3 text-sm text-secondary">Showing the first 25.</p>}
      </CardContent>
    </Card>
  );
}

export default async function ClientSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { upcoming, past } = await withServerTenant(async (tx, actor) => ({
    upcoming: await listSessions(tx, actor, { clientId: client.id, scope: 'upcoming' }),
    past: await listSessions(tx, actor, { clientId: client.id, scope: 'past' }),
  }));
  const today = todayInZone(client.timezone);
  const week = isoWeekOf(today);
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(`${week.start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  );
  const byDay = new Map<string, (typeof upcoming.items)[number][]>();
  for (const s of [...past.items, ...upcoming.items]) {
    if (s.scheduledLocalDate < week.start || s.scheduledLocalDate > week.end) continue;
    byDay.set(s.scheduledLocalDate, [...(byDay.get(s.scheduledLocalDate) ?? []), s]);
  }

  if (upcoming.items.length === 0 && past.items.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        body="Sessions appear here once this client has a program."
        action={
          <Link
            href={`/app/clients/${client.id}/program`}
            className={buttonVariants({ variant: 'secondary' })}
          >
            Go to Program
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="week-strip" className="flex flex-col gap-3">
        <h2 id="week-strip" className="text-h2 font-semibold">
          This week
        </h2>
        <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const isToday = d === today;
            return (
              <li
                key={d}
                className={cn(
                  'flex min-h-28 min-w-0 flex-col gap-1.5 rounded-md border bg-surface p-1.5 sm:p-2',
                  isToday ? 'border-cyan ring-1 ring-cyan' : 'border-border',
                )}
              >
                <p className="text-center leading-tight">
                  <span className="label-micro block text-secondary">{weekdayShort(d)}</span>
                  <span
                    className={cn('tabular text-h3 font-semibold', isToday && 'text-cyan-strong')}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {isToday && <span className="sr-only"> (today)</span>}
                </p>
                {list.length === 0 ? (
                  <span className="mt-auto text-center text-micro text-secondary">Rest</span>
                ) : (
                  list.map((s) => (
                    <Link
                      key={s.id}
                      href={`/app/clients/${client.id}/sessions/${s.id}`}
                      aria-label={`${weekdayShort(d)}: ${s.title}, ${sessionStateLabel(s.state, s.overdue)}`}
                      title={s.title}
                      className="flex min-h-9 items-center justify-center rounded-sm bg-surface-2 p-1 hover:bg-accent-soft"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-full rounded-full"
                        style={{ background: STATE_COLOR[bucketOf(s.state, s.overdue) ?? 'due'] }}
                      />
                    </Link>
                  ))
                )}
              </li>
            );
          })}
        </ol>
      </section>
      <SessionList
        title="Upcoming"
        items={upcoming.items}
        clientId={client.id}
        today={today}
        // An archived client's sessions are read-only history (D-010 #4).
        action={client.status === 'archived' ? 'View' : 'Log workout'}
        more={upcoming.nextCursor !== null}
      />
      <SessionList
        title="Past"
        items={past.items}
        clientId={client.id}
        today={today}
        action="View"
        more={past.nextCursor !== null}
      />
    </div>
  );
}
