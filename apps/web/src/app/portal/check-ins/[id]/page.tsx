import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkinWeekSummary, DomainError, getCheckin } from '@kinetic/core';
import { CheckinFormLoader } from '@/components/checkins/CheckinFormLoader';
import { WeekSummary } from '@/components/checkins/WeekSummary';
import { formatDate } from '@/app/app/clients/StatusBadge';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Check-in | Kinetic' };

export default async function PortalCheckin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let checkin;
  let week;
  let units: 'kg' | 'lb' = 'kg';
  try {
    ({ checkin, week, units } = await withPortalTenant(async (tx, actor) => {
      const c = await getCheckin(tx, actor, id);
      const me = await tx.client.findFirst({
        where: { id: c.clientId },
        select: { preferredUnits: true },
      });
      return {
        checkin: c,
        week: await checkinWeekSummary(tx, actor, c.clientId, c.periodLocalDate),
        units: me?.preferredUnits ?? ('kg' as const),
      };
    }));
  } catch (error) {
    // Unknown or another client's check-in: the same 404.
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  return (
    <>
      <Link
        href="/portal/check-ins"
        className="mb-4 inline-flex min-h-11 items-center text-accent underline underline-offset-4"
      >
        All check-ins
      </Link>
      <h1 className="mb-1 text-2xl font-semibold break-words md:text-3xl">{checkin.title}</h1>
      <p className="mb-6 text-secondary">Week of {formatDate(checkin.periodLocalDate)}</p>
      <div className="mb-6 rounded-card bg-surface p-4 shadow-card">
        <WeekSummary summary={week} units={units} heading="Your week" />
        <p className="mt-2 text-sm text-secondary">
          Filled in from what you logged, so you don&apos;t need to enter it again.
        </p>
      </div>
      <CheckinFormLoader initial={checkin} />
    </>
  );
}
