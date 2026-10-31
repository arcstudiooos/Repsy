import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getExerciseHistory, getPersonalRecords, isUuid } from '@kinetic/core';
import { ExerciseProgress, RecordsList } from '@/components/progress/Progress';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Progress | Kinetic' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** The client's personal records (PRD E6) and, with ?exercise=, one exercise's workouts (E7). Loads in the client's units. */
export default async function ClientProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const client = await loadClient((await params).id);
  const exerciseId = first((await searchParams).exercise);
  const base = `/app/clients/${client.id}/progress`;
  const units = client.preferredUnits;

  if (exerciseId !== undefined && !isUuid(exerciseId)) notFound();
  let data;
  try {
    data = await withServerTenant(async (tx, actor) => ({
      records: await getPersonalRecords(tx, actor, client.id),
      history:
        exerciseId !== undefined
          ? await getExerciseHistory(tx, actor, client.id, exerciseId)
          : null,
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { records, history } = data;

  if (history) {
    return (
      <>
        <h2 className="mb-4 text-xl font-semibold">{history.exercise.name}</h2>
        <ExerciseProgress
          records={records.find((r) => r.exerciseId === history.exercise.exerciseId) ?? null}
          entries={history.entries}
          units={units}
          backHref={base}
        />
      </>
    );
  }

  return (
    <RecordsList
      records={records}
      units={units}
      hrefFor={(id) => `${base}?exercise=${id}`}
      emptyBody="Records appear once the client completes a logged workout."
    />
  );
}
