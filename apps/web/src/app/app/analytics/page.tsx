import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { DomainError, getAnalytics, isoWeekOf, todayInZone, type Ratio } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../clients/StatusBadge';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Analytics | Kinetic' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const pct = (r: Ratio) => `${Math.round((r.numerator / r.denominator) * 100)}%`;

function Metric({
  title,
  ratio,
  empty,
  period,
  children,
}: {
  title: string;
  ratio?: Ratio;
  empty?: string;
  period: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        <CardDescription>{period}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {ratio &&
          (ratio.denominator === 0 ? (
            <p className="text-secondary">{empty}</p>
          ) : (
            <p>
              <span className="text-3xl font-semibold">{pct(ratio)}</span>{' '}
              <span className="text-secondary">
                ({ratio.numerator} of {ratio.denominator})
              </span>
            </p>
          ))}
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Coach analytics (S5-1, D-008 #1): counts only, no charts, each with its numerator, denominator and period.
 * The range defaults to this week (Monday to Sunday) in the organization's time zone.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await withServerTenant(async (tx, actor) => {
    const org = await tx.organization.findFirst({ select: { timezone: true } });
    const week = isoWeekOf(todayInZone(org?.timezone ?? 'UTC'));
    const range = { from: first(sp.from) ?? week.start, to: first(sp.to) ?? week.end };
    try {
      return { range, view: await getAnalytics(tx, actor, range), error: null };
    } catch (error) {
      if (error instanceof DomainError && error.code === 'VALIDATION') {
        const message = Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message;
        return { range, view: null, error: message };
      }
      throw error;
    }
  });
  const { range, view } = result;
  const period = `${formatDate(range.from)} to ${formatDate(range.to)}`;
  return (
    <>
      <PageHeader
        title="Analytics"
        description="How your clients are training and checking in, for the dates you pick."
        actions={
          <Link href="/app/analytics/business" className={buttonVariants({ variant: 'secondary' })}>
            Business analytics
          </Link>
        }
      />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-sm font-medium">
            From
          </label>
          <Input id="from" name="from" type="date" defaultValue={range.from} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-sm font-medium">
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={range.to} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <Link
          href="/app/analytics"
          className="inline-flex min-h-11 items-center text-accent underline underline-offset-4"
        >
          This week
        </Link>
      </form>
      {result.error && (
        <p role="alert" className="mb-6 text-danger">
          {result.error}
        </p>
      )}
      {view && (
        <div className="grid gap-4 md:grid-cols-2">
          <Metric
            title="Adherence"
            ratio={{ numerator: view.adherence.completed, denominator: view.adherence.eligible }}
            empty="No sessions due yet"
            period={`Workouts scheduled ${period} whose due time has passed`}
          >
            <ul className="text-sm text-secondary">
              <li>{view.adherence.skipped} skipped</li>
              <li>{view.adherence.incomplete} not finished</li>
              <li>{view.adherence.missed} missed</li>
            </ul>
            <p className="text-sm text-secondary">Paused and cancelled workouts are not counted.</p>
          </Metric>
          <Metric title="Assigned vs finished" period={`Workouts scheduled ${period}`}>
            <p>
              <span className="text-3xl font-semibold">{view.workouts.finished}</span>{' '}
              <span className="text-secondary">
                finished of {view.workouts.assigned} assigned (completed or skipped)
              </span>
            </p>
          </Metric>
          <Metric
            title="Check-in response rate"
            ratio={view.responseRate}
            empty="No check-ins due yet"
            period={`Check-ins for ${period} whose due time has passed`}
          />
          <Metric title="Due check-ins" period={`Check-ins for ${period}`}>
            <p>
              <span className="text-3xl font-semibold">{view.dueCheckins}</span>{' '}
              <span className="text-secondary">waiting for the client</span>
            </p>
          </Metric>
          <Metric title="Time to follow-up" period={`Review items you closed ${period}`}>
            {view.timeToFollowUp.closed === 0 ? (
              <p className="text-secondary">No review items closed yet</p>
            ) : (
              <p>
                <span className="text-3xl font-semibold">{view.timeToFollowUp.medianHours} h</span>{' '}
                <span className="text-secondary">
                  median over {view.timeToFollowUp.closed} closed
                </span>
              </p>
            )}
          </Metric>
        </div>
      )}
    </>
  );
}
