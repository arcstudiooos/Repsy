import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TableData {
  columns: string[];
  rows: Array<Array<ReactNode>>;
}

/**
 * Every chart's wrapper (D-014): a visible title, a one-sentence summary used as the text alternative, an optional
 * legend, the chart, and a "View as table" disclosure with the same numbers.
 */
export function ChartFrame({
  title,
  summary,
  legend,
  table,
  action,
  children,
  className,
  titleAs: H = 'h3',
}: {
  title: ReactNode;
  /** One sentence that says what the chart shows, with the key numbers and period. */
  summary: string;
  legend?: Array<{ label: string; color: string; dashed?: boolean }>;
  table?: TableData;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  titleAs?: 'h2' | 'h3';
}) {
  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <H className="text-h3 font-semibold">{title}</H>
        {action}
      </div>
      <div role="img" aria-label={summary}>
        {children}
      </div>
      {legend && legend.length > 0 && (
        <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-secondary">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-block h-2.5 w-2.5 rounded-[3px]',
                  l.dashed && 'h-0.5 w-4 rounded-none',
                )}
                style={{ background: l.color }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <figcaption className="text-caption text-secondary">{summary}</figcaption>
      {table && (
        <details className="rounded-md border border-border text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium text-accent md:min-h-9">
            View as table
          </summary>
          <div className="overflow-x-auto px-3 pb-3">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  {table.columns.map((c, i) => (
                    <th
                      key={c}
                      scope="col"
                      className={cn('py-2 pr-3 font-medium text-secondary', i > 0 && 'text-right')}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {r.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row" className="py-2 pr-3 text-left font-normal">
                          {cell}
                        </th>
                      ) : (
                        <td key={j} className="tabular py-2 pr-3 text-right">
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
