import { PauseCircle } from 'lucide-react';

const formatLong = (localDate: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${localDate}T00:00:00Z`));

/** Shown on the portal while the client's program is paused (S3-5). */
export function PausedBanner({ resumeLocalDate }: { resumeLocalDate: string }) {
  return (
    <div
      role="status"
      className="flex gap-3 rounded-card border border-input-border bg-surface p-4"
    >
      <PauseCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
      <div>
        <p className="font-semibold">Program paused</p>
        <p className="text-secondary">Expected back on {formatLong(resumeLocalDate)}.</p>
      </div>
    </div>
  );
}
