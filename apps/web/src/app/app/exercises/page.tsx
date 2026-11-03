import type { Metadata } from 'next';
import {
  DomainError,
  searchExercises,
  TRACKING_TYPES,
  type SearchExercisesQuery,
} from '@kinetic/core';
import { ErrorState } from '@/components/states/ErrorState';
import { withServerTenant } from '@/server/serverActor';
import { ExerciseLibrary } from './ExerciseLibrary';
import { NewExerciseDialog } from './NewExerciseDialog';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Exercise library | Kinetic' };

const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

const clean = (v: string | undefined, max: number): string | undefined =>
  v?.trim().slice(0, max) || undefined;

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = clean(first(sp.q), 100);
  const muscleGroup = clean(first(sp.muscleGroup), 40);
  const equipment = clean(first(sp.equipment), 40);
  const trackingParam = first(sp.trackingType);
  const trackingType = TRACKING_TYPES.find((t) => t === trackingParam);
  const cursor = first(sp.cursor);
  const query: SearchExercisesQuery = { q, muscleGroup, equipment, trackingType, cursor };

  let result: Awaited<ReturnType<typeof searchExercises>>;
  try {
    result = await withServerTenant((tx, actor) => searchExercises(tx, actor, query));
  } catch (error) {
    // A malformed cursor in the URL is the only user-reachable validation failure.
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return (
        <>
          <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Exercise library</h1>
          <ErrorState message="That page link is no longer valid. Go back to the first page." />
        </>
      );
    }
    throw error;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Exercise library</h1>
        <NewExerciseDialog />
      </div>
      <ExerciseLibrary
        items={result.items}
        nextCursor={result.nextCursor}
        q={q ?? ''}
        muscleGroup={muscleGroup ?? ''}
        equipment={equipment ?? ''}
        trackingType={trackingType ?? ''}
        hasCursor={cursor !== undefined}
      />
    </>
  );
}
