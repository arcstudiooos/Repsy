import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getCheckin } from '@kinetic/core';
import { CheckinFormLoader } from '@/components/checkins/CheckinFormLoader';
import { formatDate } from '@/app/app/clients/StatusBadge';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Check-in | Kinetic' };

export default async function PortalCheckin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let checkin;
  try {
    checkin = await withPortalTenant((tx, actor) => getCheckin(tx, actor, id));
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
      <CheckinFormLoader initial={checkin} />
    </>
  );
}
