import { cn } from '@/lib/utils';

type Tone = 'brand' | 'cyan' | 'success' | 'warning' | 'danger';
const FILL: Record<Tone, string> = {
  brand: 'bg-ember',
  cyan: 'bg-cyan',
  success: 'bg-success',
  warning: 'bg-warning-fill',
  danger: 'bg-danger',
};

/**
 * A progress bar with an accessible name and value. `value` of `max`; the visible number is the caller's job (the
 * bar alone never carries the figure).
 */
export function Progress({
  value,
  max = 100,
  label,
  valueText,
  tone = 'brand',
  className,
  size = 'md',
}: {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  tone?: Tone;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-2',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
