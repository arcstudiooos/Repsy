import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { getClientTimeline, type TimelineKind } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { formatLocalDateTime } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'History | Kinetic' };

const KIND: Record<TimelineKind, string> = {
  assignment: 'Program',
  program_version: 'Program',
  session: 'Workout',
  correction: 'Log change',
  checkin: 'Check-in',
  pause: 'Pause',
  note: 'Private note',
};

/** The client's history (S4-5), newest first, in the client's time zone. Private notes are marked and styled apart. */
export default async function ClientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const events = await withServerTenant((tx, actor) => getClientTimeline(tx, actor, client.id));
  if (events.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        body="Assignments, workouts, check-ins and notes will show here."
      />
    );
  }
  return (
    <ol aria-label="History" className="flex flex-col gap-3">
      {events.map((e) => (
        <li
          key={e.id}
          className={cn(
            'rounded-card bg-surface p-4 shadow-card',
            e.private && 'border border-dashed border-input-border shadow-none',
          )}
        >
          <p className="flex flex-wrap items-center gap-2 text-sm text-secondary">
            {e.private && <Lock aria-hidden className="size-4" />}
            <span className="font-medium">{KIND[e.kind]}</span>
            <span aria-hidden>·</span>
            <time dateTime={e.at}>{formatLocalDateTime(e.at, client.timezone)}</time>
          </p>
          <p className="mt-1 font-medium break-words">
            {e.href ? (
              <Link href={e.href} className="underline underline-offset-4">
                {e.title}
              </Link>
            ) : (
              e.title
            )}
          </p>
          {e.detail && (
            <p className="mt-1 break-words whitespace-pre-line text-secondary">{e.detail}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
