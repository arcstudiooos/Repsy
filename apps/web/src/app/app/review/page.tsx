import type { Metadata } from 'next';
import Link from 'next/link';
import { getReviewOverview, todayInZone, type ReviewSection } from '@kinetic/core';
import { LoggedByCoachBadge, SessionStateBadge } from '@/components/sessions/SessionStateBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSessionDate } from '@/lib/session-format';
import { withServerTenant } from '@/server/serverActor';
import { MarkSeenButton } from './MarkSeenButton';

export const metadata: Metadata = { title: 'Review | Kinetic' };

function Section({
  id,
  title,
  description,
  empty,
  section,
  today,
  action,
}: {
  id: string;
  title: string;
  description: string;
  empty: string;
  section: ReviewSection;
  today: string;
  action?: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle id={headingId}>
              {title} ({section.count})
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {action}
        </CardHeader>
        <CardContent>
          {section.items.length === 0 ? (
            <p className="text-secondary">{empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider">
              {section.items.map((item) => (
                <li key={item.sessionId} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/clients/${item.clientId}`}
                      className="font-semibold break-words text-accent underline underline-offset-4"
                    >
                      {item.clientName}
                    </Link>
                    <span aria-hidden>·</span>
                    <Link
                      href={`/app/clients/${item.clientId}/sessions/${item.sessionId}`}
                      className="break-words underline underline-offset-4"
                    >
                      {item.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                    <span>{formatSessionDate(item.scheduledLocalDate, today)}</span>
                    <SessionStateBadge state={item.state} overdue={false} />
                    {item.loggedByCoach && <LoggedByCoachBadge />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {section.count > section.items.length && (
            <p className="mt-3 text-sm text-secondary">
              Showing {section.items.length} of {section.count}.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Sprint 2 review list (S2-4): statuses and counts read from sessions on every request, so a completion shows on
 * the next load. Snooze, resolve and the missed-workout rules arrive with review flags in Sprint 4.
 */
export default async function ReviewPage() {
  const { review, timezone } = await withServerTenant(async (tx, actor) => ({
    review: await getReviewOverview(tx, actor),
    timezone:
      (
        await tx.organization.findFirst({
          where: { id: actor.orgId },
          select: { timezone: true },
        })
      )?.timezone ?? 'UTC',
  }));
  const today = todayInZone(timezone);
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Review</h1>
      <div className="flex flex-col gap-6">
        <Section
          id="new"
          title="New completed workouts"
          description={
            review.seenAt
              ? 'Completed since you last marked the list as seen.'
              : 'Completed in the last 14 days.'
          }
          empty="No new completed workouts."
          section={review.newCompleted}
          today={today}
          action={review.newCompleted.count > 0 ? <MarkSeenButton /> : undefined}
        />
        <Section
          id="due"
          title="Due this week"
          description="Workouts not finished yet, scheduled this week."
          empty="Nothing else is due this week."
          section={review.dueThisWeek}
          today={today}
        />
        <Section
          id="skipped"
          title="Skipped this week"
          description="Workouts your clients chose to skip this week."
          empty="No skipped workouts this week."
          section={review.skippedThisWeek}
          today={today}
        />
      </div>
    </>
  );
}
