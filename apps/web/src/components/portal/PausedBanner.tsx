import { PauseCircle } from 'lucide-react';

const formatLong = (localDate: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));

/**
 * Shown on the portal while the client's program is paused (S3-5), and from the day a pause is booked: a pause that
 * starts later says when, since workouts are still due until then (PR #2 review A).
 */
export function PausedBanner({
  startLocalDate,
  resumeLocalDate,
  todayLocalDate,
}: {
  startLocalDate: string;
  resumeLocalDate: string;
  todayLocalDate: string;
}) {
  const upcoming = startLocalDate > todayLocalDate;
  return (
    <div
      role="status"
      className="flex gap-3 rounded-card border border-input-border bg-surface p-4"
    >
      <PauseCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <div>
        <p className="font-semibold">{upcoming ? 'Pause coming up' : 'Program paused'}</p>
        <p className="text-secondary">
          {upcoming
            ? `Your program pauses on ${formatLong(startLocalDate)}. Expected back on ${formatLong(resumeLocalDate)}.`
            : `Expected back on ${formatLong(resumeLocalDate)}.`}
        </p>
      </div>
    </div>
  );
}
