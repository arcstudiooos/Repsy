import { cn } from '@/lib/utils';

export type RingTone = 'accent' | 'success' | 'warning' | 'danger' | 'energy';

const STROKE: Record<RingTone, string> = {
  accent: 'var(--k-accent)',
  success: 'var(--k-success)',
  warning: 'var(--k-warning)',
  danger: 'var(--k-danger)',
  energy: 'var(--k-energy)',
};

/** Good / getting there / needs a nudge. The figure is always printed too; colour is the second signal. */
export function toneFor(pct: number): RingTone {
  return pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger';
}

/**
 * A progress ring with the percentage in the middle. `value` null draws an empty track and a dash: nothing due.
 * Decorative for assistive tech: callers print the numerator and denominator beside it.
 */
export function Ring({
  value,
  size = 96,
  stroke = 10,
  tone,
  label,
  className,
}: {
  /** 0 to 100, or null when nothing was due. */
  value: number | null;
  size?: number;
  stroke?: number;
  tone?: RingTone;
  /** Small text under the figure inside the ring. */
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const color = STROKE[tone ?? (value === null ? 'accent' : toneFor(pct))];
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
          stroke="var(--k-surface-muted)"
          strokeWidth={stroke}
        />
        {value !== null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-500"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className="tabular font-bold tracking-tight text-ink"
          style={{ fontSize: Math.round(size * 0.24) }}
        >
          {value === null ? '–' : `${Math.round(pct)}%`}
        </span>
        {label && <span className="mt-1 text-[11px] text-secondary">{label}</span>}
      </span>
    </div>
  );
}
