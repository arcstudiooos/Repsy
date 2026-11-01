import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  DomainError,
  getExerciseHistory,
  getPersonalRecords,
  isUuid,
  listMetrics,
  todayInZone,
  listProgressPhotos,
} from '@kinetic/core';
import { MetricsPanel } from '@/components/progress/MetricsPanel';
import { ExerciseProgress, RecordsList } from '@/components/progress/Progress';
import { ProgressPhotos } from '@/components/progress/ProgressPhotos';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Progress | Kinetic' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** The client's body metrics (PRD E1) and personal records (PRD E6) and, with ?exercise=, one exercise's workouts (E7). Loads in the client's units. */
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
      metrics: exerciseId === undefined ? await listMetrics(tx, actor, client.id) : null,
      records: await getPersonalRecords(tx, actor, client.id),
      photos: exerciseId === undefined ? await listProgressPhotos(tx, actor, client.id) : [],
      history:
        exerciseId !== undefined
          ? await getExerciseHistory(tx, actor, client.id, exerciseId)
          : null,
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { metrics, records, history, photos } = data;

  if (history) {
    return (
      <>
        <h2 className="mb-4 text-xl font-semibold">{history.exercise.name}</h2>
        <ExerciseProgress
          records={records.find((r) => r.exerciseId === history.exercise.exerciseId) ?? null}
          entries={history.entries}
          units={units}
          backHref={base}
          today={todayInZone(client.timezone)}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {metrics && <MetricsPanel clientId={client.id} view={metrics} isCoach />}
      <ProgressPhotos
        clientId={client.id}
        photos={photos}
        today={todayInZone(client.timezone)}
        canUpload={client.status !== 'archived'}
      />
      <section aria-labelledby="records-heading" className="flex flex-col gap-4">
        <h2 id="records-heading" className="text-lg font-semibold">
          Personal records
        </h2>
        <RecordsList
          records={records}
          units={units}
          hrefFor={(id) => `${base}?exercise=${id}`}
          emptyBody="Records appear once the client completes a logged workout."
        />
      </section>
    </div>
  );
}
