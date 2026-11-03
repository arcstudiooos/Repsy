import type { Metadata } from 'next';
import Link from 'next/link';
import { listSharedWorkouts } from '@kinetic/core';
import { ExtraWorkoutStarter } from '@/components/workout/ExtraWorkoutStarter';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Extra workout | Kinetic' };

/** PRD D13: start an unplanned workout, from one the coach shares or from scratch. */
export default async function ExtraWorkoutPage() {
  const shared = await withPortalTenant((tx, actor) => listSharedWorkouts(tx, actor));
  return (
    <>
      <Link href="/portal/workouts" className="mb-4 inline-flex min-h-11 items-center text-accent">
        Back to workouts
      </Link>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Log an extra workout</h1>
      <p className="mb-6 text-secondary">
        Did something that isn&apos;t in your plan? Log it here. It shows in your history and
        records, and doesn&apos;t change your plan or your adherence.
      </p>
      <ExtraWorkoutStarter shared={shared} />
    </>
  );
}
