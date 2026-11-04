import type { Metadata } from 'next';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import {
  clientCourses,
  getClientTimeline,
  listSequences,
  runHistory,
  TRAINER_ROLES,
  type TimelineKind,
} from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { formatLocalDateTime } from '@/lib/session-format';
import { cn } from '@/lib/utils';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';
import { ClientAutomations } from './ClientAutomations';
import { ClientCourses } from './ClientCourses';

export const metadata: Metadata = { title: 'History | Repsy' };

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
  const { events, runs, sequences, canEdit, courses } = await withServerTenant(
    async (tx, actor) => ({
      events: await getClientTimeline(tx, actor, client.id),
      // PRD J8: every automation run and step for this client.
      runs: await runHistory(tx, actor, client.id),
      sequences: (await listSequences(tx, actor))
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name })),
      canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
      // PRD G4.
      courses: await clientCourses(tx, actor, client.id),
    }),
  );
  const automations = (
    <>
      <ClientCourses courses={courses} />
      <ClientAutomations
        clientId={client.id}
        timezone={client.timezone}
        runs={runs}
        sequences={sequences}
        canEdit={canEdit}
      />
    </>
  );
  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {automations}
        <EmptyState
          title="No history yet"
          body="Assignments, workouts, check-ins and notes will show here."
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {automations}
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
    </div>
  );
}
