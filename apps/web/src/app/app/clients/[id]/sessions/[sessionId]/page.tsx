import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getSessionDetail, todayInZone, type Units } from '@kinetic/core';
import { LogEditor } from '@/components/workout/LogEditor';
import { RevisionTrail } from '@/components/workout/RevisionTrail';
import { WorkoutLogger } from '@/components/workout/WorkoutLogger';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../../data';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Log workout | Kinetic' };

/** D-008 #7: a coach logs a workout on the client's behalf. The session must belong to the client in the URL. */
export default async function CoachSessionPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const client = await loadClient(id);
  let data;
  try {
    data = await withServerTenant(async (tx, actor) => {
      const detail = await getSessionDetail(tx, actor, sessionId);
      const profile = await tx.coachProfile.findFirst({
        where: { userId: actor.userId },
        select: { units: true },
      });
      return { detail, units: (profile?.units ?? 'kg') as Units };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (data.detail.session.clientId !== client.id) notFound();
  const backHref = `/app/clients/${client.id}/sessions`;
  return (
    <div>
      <Link
        href={backHref}
        className="mb-4 inline-flex min-h-11 items-center text-accent underline underline-offset-4"
      >
        All sessions
      </Link>
      <WorkoutLogger
        key={`${data.detail.session.state}:${
          data.detail.logs
            .map((l) => l.clientUpdatedAt)
            .sort()
            .at(-1) ?? ''
        }:${data.detail.revisions.length}`}
        initial={data.detail}
        mode="coach"
        units={data.units}
        todayLocalDate={todayInZone(client.timezone)}
        backHref={backHref}
      />
      {/* S3-4: a coach corrects a finished workout at any time, with a reason. */}
      {(data.detail.session.state === 'completed' || data.detail.session.state === 'skipped') && (
        <LogEditor detail={data.detail} mode="coach" units={data.units} />
      )}
      <RevisionTrail detail={data.detail} units={data.units} timeZone={client.timezone} />
    </div>
  );
}
