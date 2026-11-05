import { cn } from '@/lib/utils';

export interface StackedColumn {
  label: string;
  parts: Array<{ key: string; value: number; color: string }>;
  highlight?: boolean;
}

/** Stacked columns (server SVG via flex), e.g. sessions per day by state. Totals print above each column. */
export function StackedBar({
  columns,
  height = 140,
}: {
  columns: StackedColumn[];
  height?: number;
}) {
  const max = Math.max(1, ...columns.map((c) => c.parts.reduce((s, p) => s + p.value, 0)));
  return (
    <div aria-hidden className="w-full">
      <div className="flex items-end gap-2" style={{ height }}>
        {columns.map((col) => {
          const total = col.parts.reduce((s, p) => s + p.value, 0);
          return (
            <div
              key={col.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <span
                className={cn(
                  'tabular text-micro',
                  col.highlight ? 'font-semibold text-ink' : 'text-secondary',
                )}
              >
                {total || ''}
              </span>
              <div
                className={cn(
                  'k-grow-up flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-[6px]',
                  total === 0 && 'h-1 bg-surface-2',
                  col.highlight && 'ring-2 ring-on-acid ring-offset-2 ring-offset-acid',
                )}
                style={total ? { height: (total / max) * (height - 20) } : undefined}
              >
                {col.parts.map((p) =>
                  p.value > 0 ? (
                    <span key={p.key} style={{ flexGrow: p.value, background: p.color }} />
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {columns.map((c) => (
          <span
            key={c.label}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-micro',
              c.highlight ? 'font-semibold text-ink' : 'text-secondary',
            )}
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
