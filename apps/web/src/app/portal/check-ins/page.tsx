import type { Metadata } from 'next';
import Link from 'next/link';
import { checkinStreak, listCheckins, todayInZone } from '@repsy/core';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { formatSessionDate } from '@/lib/session-format';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Check-ins | Repsy' };

const STATUS = { open: 'To do', overdue: 'Past due', submitted: 'Sent' } as const;

// Access is enforced by src/proxy.ts and the portal layout's client gate; core scopes to this client.
export default async function PortalCheckins() {
  const { checkins, today, streak } = await withPortalTenant(async (tx, actor) => {
    const client = await tx.client.findFirst({
      where: { id: actor.clientId },
      select: { timezone: true },
    });
    return {
      checkins: await listCheckins(tx, actor),
      streak: await checkinStreak(tx, actor),
      today: todayInZone(client?.timezone ?? 'UTC'),
    };
  });
  return (
    <>
      <h1 className="mb-2 text-h1 font-semibold md:text-display">Check-ins</h1>
      <p className="mb-6 text-secondary">
        {streak > 0
          ? `${streak} on time in a row. Keep it going.`
          : 'Send each check-in by its due day to start a streak.'}
      </p>
      {checkins.length === 0 ? (
        <EmptyState
          title="No check-ins yet"
          body="Your coach's weekly check-in will show up here on its day."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {checkins.map((c) => (
            <li key={c.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-sm text-secondary">
                      {formatSessionDate(c.periodLocalDate, today)} · {STATUS[c.status]}
                    </p>
                    {c.reviewedAt && (
                      <p className="text-sm text-accent">Your coach reviewed this</p>
                    )}
                  </div>
                  <Link
                    href={`/portal/check-ins/${c.id}`}
                    className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
                    aria-label={`${c.status === 'submitted' ? 'View' : 'Fill in'} ${c.title}, ${formatSessionDate(c.periodLocalDate, today)}`}
                  >
                    {c.status === 'submitted' ? 'View' : 'Fill in'}
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
