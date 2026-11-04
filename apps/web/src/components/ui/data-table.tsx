import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Cell content. The first column is the row header (scope="row"). */
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  /** Hide below 768px, where rows collapse to cards. */
  className?: string;
  /** A sort link for this header (URL-driven sorting); `sorted` marks the current direction. */
  sortHref?: string;
  sorted?: 'ascending' | 'descending';
}

/**
 * A table with a sticky header and row hover; from 768px down each row collapses to a card (header label + value
 * pairs). URL-driven sorting keeps it a server component.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  caption,
  rowHref,
  empty,
}: {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  /** Names the table for assistive tech. */
  caption: string;
  /** Makes the first cell a link to the row's page. */
  rowHref?: (row: Row) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const [first, ...rest] = columns;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface shadow-e1 md:block">
        <table className="w-full text-left text-body">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sorted}
                  className={cn(
                    'label-micro px-4 py-3 text-secondary',
                    c.align === 'right' && 'text-right',
                  )}
                >
                  {c.sortHref ? (
                    <Link
                      href={c.sortHref}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      {c.header}
                      <span aria-hidden>
                        {c.sorted === 'ascending' ? '↑' : c.sorted === 'descending' ? '↓' : '↕'}
                      </span>
                    </Link>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                className="border-t border-border transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-2/60"
              >
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  {rowHref ? (
                    <Link
                      href={rowHref(r)}
                      className="font-medium hover:text-accent hover:underline"
                    >
                      {first!.cell(r)}
                    </Link>
                  ) : (
                    first!.cell(r)
                  )}
                </th>
                {rest.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3', c.align === 'right' && 'text-right')}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="flex flex-col gap-2 md:hidden">
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className="rounded-card border border-border bg-surface p-4 shadow-e1"
          >
            <div className="font-medium">
              {rowHref ? <Link href={rowHref(r)}>{first!.cell(r)}</Link> : first!.cell(r)}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {rest.map((c) => (
                <div key={c.key}>
                  <dt className="label-micro text-secondary">{c.header}</dt>
                  <dd className="mt-0.5">{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
