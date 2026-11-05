import { cn } from '@/lib/utils';

/**
 * A ring with the percentage in the middle (server SVG). `value` null draws the track and a dash (nothing due).
 * Decorative for assistive tech: callers print the numerator and denominator next to it.
 */
export function ProgressRing({
  value,
  size = 96,
  stroke = 10,
  tone = 'ember',
  label,
  className,
  onDark = false,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  tone?: 'ember' | 'cyan' | 'success';
  label?: string;
  className?: string;
  /** On a midnight tile: lighter track and white figure. */
  onDark?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  // On a brand hero surface the ring is acid (the highlight); elsewhere the tone's colour.
  const color = onDark
    ? 'var(--k-acid)'
    : { ember: 'var(--k-brand)', cyan: 'var(--k-cyan)', success: 'var(--k-success)' }[tone];
  return (
    <div
      aria-hidden
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={
            onDark
              ? 'color-mix(in srgb, var(--k-on-midnight) 18%, transparent)'
              : 'var(--k-brand-soft)'
          }
          strokeWidth={stroke}
        />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            className="k-ring-draw"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className={cn(
            'tabular font-semibold tracking-tight',
            onDark ? 'text-on-midnight' : 'text-ink',
          )}
          style={{ fontSize: Math.round(size * 0.24) }}
        >
          {value === null ? '–' : `${Math.round(pct)}%`}
        </span>
        {label && (
          <span
            className={cn('mt-1 text-micro', onDark ? 'text-on-midnight-muted' : 'text-secondary')}
          >
            {label}
          </span>
        )}
      </span>
    </div>
  );
}
