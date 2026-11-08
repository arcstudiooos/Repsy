import type { SessionDetail, Units } from '@repsy/core';
import { describeRevisionChange, formatLocalDateTime } from '@/lib/session-format';

/**
 * The coach's view of every change made to a finished workout's log (S3-4), oldest first:
 * "{name} changed set {n} of {exercise}: 8 → 10 reps · {reason}". Reasons are coach-only (Ruling 5).
 */
export function RevisionTrail({
  detail,
  units,
  timeZone,
}: {
  detail: SessionDetail;
  units: Units;
  /** The client's zone, for the change times. */
  timeZone: string;
}) {
  if (detail.revisions.length === 0) return null;
  const exercises = new Map(detail.workout.exercises.map((e) => [e.id, e]));
  return (
    <section aria-labelledby="log-changes" className="mt-6 flex flex-col gap-2">
      <h3 id="log-changes" className="text-lg font-semibold">
        Log changes
      </h3>
      <ol className="flex flex-col gap-2">
        {detail.revisions.map((r, i) => {
          const e = exercises.get(r.workoutVersionExerciseId);
          const change = describeRevisionChange(
            r.before,
            r.after,
            e?.trackingType ?? 'reps_load',
            units,
          );
          return (
            <li
              key={`${r.createdAt}:${r.workoutVersionExerciseId}:${r.setIndex}:${i}`}
              className="rounded-control border border-divider px-3 py-2 break-words"
            >
              <p>
                {r.revisedByName} changed set {r.setIndex + 1} of {e?.name ?? 'an exercise'}:{' '}
                {change}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
              <p className="text-sm text-secondary">
                {r.role === 'coach' ? 'Coach correction' : 'Client edit'},{' '}
                <time dateTime={r.createdAt}>{formatLocalDateTime(r.createdAt, timeZone)}</time>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
