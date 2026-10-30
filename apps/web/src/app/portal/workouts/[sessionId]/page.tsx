import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getSessionDetail, todayInZone } from '@kinetic/core';
import { WorkoutLogger } from '@/components/workout/WorkoutLogger';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Workout | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate; core scopes the session to this client.
export default async function PortalWorkout({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  let data;
  try {
    data = await withPortalTenant(async (tx, actor) => {
      const detail = await getSessionDetail(tx, actor, sessionId);
      const client = await tx.client.findFirst({
        where: { id: actor.clientId },
        select: { timezone: true },
      });
      return { detail, today: todayInZone(client?.timezone ?? 'UTC') };
    });
  } catch (error) {
    // Unknown, cancelled-elsewhere or another client's session: the same 404 (no existence leak).
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  return (
    <>
      <Link
        href="/portal/workouts"
        className="mb-4 inline-flex min-h-11 items-center text-accent underline underline-offset-4"
      >
        All workouts
      </Link>
      <WorkoutLogger
        // A restored (cached) instance must not keep a stale state: remount when the server's state differs.
        key={data.detail.session.state}
        initial={data.detail}
        mode="client"
        units={data.detail.client.preferredUnits}
        todayLocalDate={data.today}
        backHref="/portal/workouts"
      />
    </>
  );
}
