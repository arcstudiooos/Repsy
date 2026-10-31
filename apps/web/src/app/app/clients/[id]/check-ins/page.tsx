import type { Metadata } from 'next';
import Link from 'next/link';
import { listCheckins, weekActivityBefore } from '@kinetic/core';
import { CheckinAnswersList } from '@/components/checkins/CheckinAnswersList';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { plural } from '@/lib/session-format';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../../StatusBadge';
import { loadClient } from '../data';
import { CheckinSchedule } from './CheckinSchedule';

export const metadata: Metadata = { title: 'Check-ins | Kinetic' };

const STATUS = {
  open: 'Waiting for the client',
  overdue: 'Past due',
  submitted: 'Submitted',
} as const;
/** Activity is shown beside the most recent check-ins only. */
const WITH_ACTIVITY = 12;

export default async function ClientCheckinsPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const items = await withServerTenant(async (tx, actor) => {
    const checkins = await listCheckins(tx, actor, { clientId: client.id });
    const out = [];
    for (const [i, c] of checkins.entries()) {
      out.push({
        checkin: c,
        activity:
          i < WITH_ACTIVITY
            ? await weekActivityBefore(tx, actor, client.id, c.periodLocalDate)
            : null,
      });
    }
    return out;
  });
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly check-in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CheckinSchedule
            clientId={client.id}
            weekday={client.checkinWeekday}
            disabled={client.status === 'archived'}
          />
          <Link
            href="/app/check-ins"
            className="self-start text-accent underline underline-offset-4"
          >
            Edit check-in questions
          </Link>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <EmptyState title="No check-ins yet" body="Check-ins will appear here once one is sent." />
      ) : (
        <ol className="flex flex-col gap-4">
          {items.map(({ checkin: c, activity }) => (
            <li key={c.id}>
              <Card>
                <CardHeader>
                  <CardTitle as="h3">Week of {formatDate(c.periodLocalDate)}</CardTitle>
                  <CardDescription>
                    {c.title} · {STATUS[c.status]}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-[2fr_1fr]">
                  {c.answers ? (
                    <CheckinAnswersList questions={c.questions} answers={c.answers} />
                  ) : (
                    <p className="text-secondary">No answers yet.</p>
                  )}
                  {activity && (
                    <section aria-label="Week before" className="text-sm">
                      <h4 className="mb-1 font-semibold">Week before</h4>
                      <p className="text-secondary">
                        {formatDate(activity.fromLocalDate)} to {formatDate(activity.toLocalDate)}
                      </p>
                      {activity.total === 0 ? (
                        <p>No workouts scheduled.</p>
                      ) : (
                        <ul>
                          <li>
                            {activity.completed} of {plural(activity.total, 'workout', 'workouts')}{' '}
                            completed
                          </li>
                          <li>{activity.skipped} skipped</li>
                          <li>{activity.missed} missed</li>
                        </ul>
                      )}
                    </section>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
