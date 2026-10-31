import Link from 'next/link';
import type { ExerciseHistoryEntry, ExerciseRecords } from '@kinetic/core';
import { toDisplay, type Units } from '@kinetic/core/units';
import { EmptyState } from '@/components/states/EmptyState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/app/app/clients/StatusBadge';

const load = (kg: number, units: Units) => `${toDisplay(kg, units)} ${units}`;

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s} s`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${Math.round(meters / 10) / 100} km` : `${meters} m`;
}

/** The headline record for an exercise, by its tracking type. */
function headline(r: ExerciseRecords, units: Units): { value: string; detail: string | null } {
  if (r.trackingType === 'duration' && r.longestDuration) {
    return { value: formatDuration(r.longestDuration.seconds), detail: 'longest' };
  }
  if (r.trackingType === 'distance' && r.longestDistance) {
    return { value: formatDistance(r.longestDistance.meters), detail: 'longest' };
  }
  if (r.estimatedOneRepMax) {
    return { value: load(r.estimatedOneRepMax.valueKg, units), detail: 'estimated 1RM' };
  }
  if (r.heaviest) return { value: load(r.heaviest.weightKg, units), detail: 'heaviest' };
  if (r.mostReps) return { value: `${r.mostReps.reps} reps`, detail: 'most in a set' };
  return { value: '–', detail: null };
}

const heaviestText = (r: ExerciseRecords, units: Units) =>
  r.heaviest ? `${load(r.heaviest.weightKg, units)} × ${r.heaviest.reps}` : '–';

/** Personal records per exercise (PRD E6): a table on wide screens, cards on phones. */
export function RecordsList({
  records,
  units,
  hrefFor,
  emptyBody,
}: {
  records: ExerciseRecords[];
  units: Units;
  hrefFor: (exerciseId: string) => string;
  emptyBody: string;
}) {
  if (records.length === 0) {
    return <EmptyState title="No records yet" body={emptyBody} />;
  }
  return (
    <>
      <div className="hidden overflow-x-auto rounded-card bg-surface shadow-card md:block">
        <table className="w-full text-left text-base">
          <caption className="sr-only">Personal records by exercise</caption>
          <thead className="border-b border-divider text-sm text-secondary">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Exercise
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Best
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Heaviest set
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Best session volume
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Workouts
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Last done
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const h = headline(r, units);
              return (
                <tr key={r.exerciseId} className="border-b border-divider last:border-0">
                  <th scope="row" className="px-4 py-2 font-medium">
                    <Link
                      href={hrefFor(r.exerciseId)}
                      className="inline-flex min-h-11 items-center underline-offset-2 hover:underline md:min-h-6"
                    >
                      {r.name}
                    </Link>
                  </th>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {h.value}
                    {h.detail && <span className="block text-sm text-secondary">{h.detail}</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{heaviestText(r, units)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {r.bestVolume ? load(r.bestVolume.volumeKg, units) : '–'}
                  </td>
                  <td className="px-4 py-2">{r.sessions}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.lastLocalDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 md:hidden" aria-label="Personal records">
        {records.map((r) => {
          const h = headline(r, units);
          return (
            <li key={r.exerciseId} className="rounded-card bg-surface p-4 shadow-card">
              <Link
                href={hrefFor(r.exerciseId)}
                className="inline-flex min-h-11 items-center font-semibold underline-offset-2 hover:underline"
              >
                {r.name}
              </Link>
              <p>
                <span className="text-lg font-semibold">{h.value}</span>
                {h.detail && <span className="text-sm text-secondary"> {h.detail}</span>}
              </p>
              <p className="text-sm text-secondary">
                Heaviest {heaviestText(r, units)} · {r.sessions} workouts · last{' '}
                {formatDate(r.lastLocalDate)}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** One exercise's records and its completed sessions, newest first (PRD E6 and E7). */
export function ExerciseProgress({
  records,
  entries,
  units,
  backHref,
}: {
  records: ExerciseRecords | null;
  entries: ExerciseHistoryEntry[];
  units: Units;
  backHref: string;
}) {
  const repMaxes = records?.repMaxes
    .map((r, i) => (r ? { reps: i + 1, r } : null))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return (
    <div className="flex flex-col gap-6">
      <Link href={backHref} className="inline-flex min-h-11 items-center text-accent underline">
        All exercises
      </Link>
      {repMaxes && repMaxes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Rep maxes</CardTitle>
            <CardDescription>The heaviest load lifted for at least that many reps.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {repMaxes.map(({ reps, r }) => (
                <div key={reps}>
                  <dt className="text-sm text-secondary">
                    {reps} {reps === 1 ? 'rep' : 'reps'}
                  </dt>
                  <dd className="font-semibold">{load(r.weightKg, units)}</dd>
                  <dd className="text-sm text-secondary">{formatDate(r.localDate)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
      <section aria-labelledby="sessions-heading" className="flex flex-col gap-3">
        <h2 id="sessions-heading" className="text-lg font-semibold">
          Workouts
        </h2>
        <div
          role="region"
          aria-labelledby="sessions-heading"
          tabIndex={0}
          className="overflow-x-auto rounded-card bg-surface shadow-card"
        >
          <table className="w-full text-left text-base">
            <thead className="border-b border-divider text-sm text-secondary">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sets
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Top set
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Est. 1RM
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Volume
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.sessionId} className="border-b border-divider last:border-0">
                  <th scope="row" className="px-4 py-2 font-normal whitespace-nowrap">
                    {formatDate(e.localDate)}
                  </th>
                  <td className="px-4 py-2">{e.sets}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.topSet
                      ? `${load(e.topSet.weightKg, units)} × ${e.topSet.reps}`
                      : e.longestSeconds !== null
                        ? formatDuration(e.longestSeconds)
                        : e.longestMeters !== null
                          ? formatDistance(e.longestMeters)
                          : `${e.totalReps} reps`}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.estimatedOneRepMaxKg !== null ? load(e.estimatedOneRepMaxKg, units) : '–'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.volumeKg > 0 ? load(e.volumeKg, units) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
