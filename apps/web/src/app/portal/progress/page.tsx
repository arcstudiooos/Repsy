import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  clientAssessments,
  listProgressReports,
  DomainError,
  getExerciseHistory,
  getPersonalRecords,
  isUuid,
  listGoals,
  listMetrics,
  todayInZone,
  listProgressPhotos,
  getTrainingLoad,
} from '@kinetic/core';
import { GoalsPanel } from '@/components/goals/GoalsPanel';
import { AssessmentPhotos } from '@/components/assessments/AssessmentPhotos';
import { MetricsPanel } from '@/components/progress/MetricsPanel';
import { ExerciseProgress, RecordsList } from '@/components/progress/Progress';
import { ProgressReports } from '@/components/progress/ProgressReports';
import { ProgressPhotos } from '@/components/progress/ProgressPhotos';
import { TrainingLoad } from '@/components/progress/TrainingLoad';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Progress | Repsy' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** The client's own body metrics (PRD E1) and personal records (PRD E6) and, with ?exercise=, one exercise's workouts (E7). */
export default async function PortalProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const exerciseId = first((await searchParams).exercise);
  if (exerciseId !== undefined && !isUuid(exerciseId)) notFound();
  let data;
  try {
    data = await withPortalTenant(async (tx, actor) => {
      const clientId = actor.clientId as string;
      const me = await tx.client.findFirst({
        where: { id: clientId },
        select: { preferredUnits: true, timezone: true },
      });
      return {
        clientId,
        units: me?.preferredUnits ?? 'kg',
        today: todayInZone(me?.timezone ?? 'UTC'),
        metrics: exerciseId === undefined ? await listMetrics(tx, actor, clientId) : null,
        goals: exerciseId === undefined ? await listGoals(tx, actor, clientId) : [],
        records: await getPersonalRecords(tx, actor, clientId),
        load: exerciseId === undefined ? await getTrainingLoad(tx, actor, clientId) : null,
        photos: exerciseId === undefined ? await listProgressPhotos(tx, actor) : [],
        assessments: exerciseId === undefined ? await clientAssessments(tx, actor) : [],
        reports: exerciseId === undefined ? await listProgressReports(tx, actor) : [],
        history:
          exerciseId !== undefined
            ? await getExerciseHistory(tx, actor, clientId, exerciseId)
            : null,
      };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const {
    clientId,
    units,
    today,
    metrics,
    goals,
    records,
    history,
    photos,
    load,
    assessments,
    reports,
  } = data;

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">
        {history ? history.exercise.name : 'Progress'}
      </h1>
      {history ? (
        <ExerciseProgress
          records={records.find((r) => r.exerciseId === history.exercise.exerciseId) ?? null}
          entries={history.entries}
          units={units}
          backHref="/portal/progress"
          today={today}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {goals.length > 0 && (
            <GoalsPanel clientId={clientId} goals={goals} units={units} canEdit={false} />
          )}
          <ProgressReports clientId={null} reports={reports} today={today} />
          {metrics && <MetricsPanel clientId={clientId} view={metrics} isCoach={false} />}
          {load && <TrainingLoad load={load} units={units} />}
          <ProgressPhotos clientId={null} photos={photos} today={today} />
          <AssessmentPhotos clientId={null} items={assessments} today={today} />
          <section aria-labelledby="records-heading" className="flex flex-col gap-4">
            <h2 id="records-heading" className="text-lg font-semibold">
              Personal records
            </h2>
            <RecordsList
              records={records}
              units={units}
              hrefFor={(id) => `/portal/progress?exercise=${id}`}
              emptyBody="Your records appear once you complete a logged workout."
            />
          </section>
        </div>
      )}
    </>
  );
}
