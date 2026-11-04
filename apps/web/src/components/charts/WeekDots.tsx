import { cn } from '@/lib/utils';
import { STATE_COLOR, STATE_LABEL, type SessionStateKey } from './palette';

export interface DayDot {
  /** "Mon". */
  label: string;
  state: SessionStateKey | 'rest';
  today?: boolean;
}

/**
 * Seven days as dots coloured by session state. Has its own text alternative (the states in words), so it can be
 * used without a surrounding ChartFrame.
 */
export function WeekDots({
  days,
  className,
  size = 'md',
}: {
  days: DayDot[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const summary = days
    .map((d) => `${d.label} ${d.state === 'rest' ? 'rest' : STATE_LABEL[d.state].toLowerCase()}`)
    .join(', ');
  const dot = size === 'sm' ? 'size-2.5' : 'size-3.5';
  return (
    <div
      role="img"
      aria-label={`This week: ${summary}`}
      className={cn('flex items-center gap-1.5', className)}
    >
      {days.map((d) => (
        <span key={d.label} className="flex flex-col items-center gap-1">
          <span
            className={cn(
              'rounded-full',
              dot,
              d.state === 'rest' && 'border border-dashed border-input-border',
              d.state === 'due' && 'border border-input-border',
              d.today && 'ring-2 ring-cyan ring-offset-1 ring-offset-surface',
            )}
            style={d.state !== 'rest' ? { background: STATE_COLOR[d.state] } : undefined}
          />
          {size === 'md' && (
            <span className="text-micro text-secondary">{d.label.slice(0, 1)}</span>
          )}
        </span>
      ))}
    </div>
  );
}
