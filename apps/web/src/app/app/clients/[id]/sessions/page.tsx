import type { Metadata } from 'next';
import Link from 'next/link';
import { listSessions, todayInZone, type SessionSummary } from '@kinetic/core';
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

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

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
