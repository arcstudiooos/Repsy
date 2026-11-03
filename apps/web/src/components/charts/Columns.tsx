import { cn } from '@/lib/utils';

export interface Column {
  label: string;
  /** null: nothing to score that period; drawn as an empty stub. */
  value: number | null;
  /** Emphasise this column (the current period). */
  current?: boolean;
}

/**
 * A small column chart for a short series (weeks, days). Values sit on the columns, labels under them, so it reads
 * without a tooltip; the whole chart has one text alternative from `summary`.
 */
export function Columns({
  data,
  max,
  summary,
  height = 120,
  className,
  format = (v) => String(Math.round(v)),
}: {
  data: Column[];
  /** Top of the scale; defaults to the largest value. */
  max?: number;
  summary: string;
  height?: number;
  className?: string;
  format?: (v: number) => string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  return (
    <figure role="img" aria-label={summary} className={cn('w-full', className)}>
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height }} aria-hidden>
        {data.map((d) => {
          const h = d.value === null ? 0 : Math.max(4, (d.value / top) * (height - 22));
          return (
            <div
              key={d.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <span
                className={cn(
                  'tabular text-[11px] font-medium',
                  d.current ? 'text-accent-ink' : 'text-secondary',
                )}
              >
                {d.value === null ? '' : format(d.value)}
              </span>
              <span
                className={cn(
                  'w-full max-w-10 rounded-t-[6px] rounded-b-[2px]',
                  d.value === null
                    ? 'h-1 bg-surface-muted'
                    : d.current
                      ? 'bg-[linear-gradient(180deg,var(--k-accent),#7c3aed)]'
                      : 'bg-accent/25',
                )}
                style={d.value === null ? undefined : { height: h }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 sm:gap-2" aria-hidden>
        {data.map((d) => (
          <span
            key={d.label}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-[11px]',
              d.current ? 'font-semibold text-ink' : 'text-secondary',
            )}
          >
            {d.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
