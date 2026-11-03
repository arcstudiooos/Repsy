import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
}

/**
 * A row of small numbers inside one panel, split by hairlines, instead of a grid of identical cards. Each cell can
 * link somewhere; its accessible name is the label then the value.
 */
export function StatStrip({
  items,
  label,
  className,
}: {
  items: StatItem[];
  label: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-card border border-border bg-surface shadow-card lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none',
        className,
      )}
    >
      {items.map((item) => {
        const body = (
          <>
            <span className="text-sm text-secondary">{item.label}</span>{' '}
            <span className="tabular mt-1 block text-2xl font-semibold text-ink md:text-[1.75rem]">
              {item.value}
            </span>
            {item.hint && <span className="mt-0.5 block text-xs text-secondary">{item.hint}</span>}
          </>
        );
        const cell = 'flex h-full flex-col p-4 md:px-5';
        return (
          <li key={item.label} className="-mr-px -mb-px border-r border-b border-divider">
            {item.href ? (
              <Link
                href={item.href}
                className={cn(
                  cell,
                  'transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-muted',
                )}
              >
                {body}
              </Link>
            ) : (
              <div className={cell}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A thin progress meter with a text value alongside, so the number is never colour-only. */
export function Meter({
  value,
  label,
  className,
}: {
  value: number | null;
  label: string;
  className?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  const tone =
    value === null ? 'bg-divider' : pct >= 75 ? 'bg-accent' : pct >= 50 ? 'bg-energy' : 'bg-danger';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : pct}
        aria-valuetext={value === null ? 'No data yet' : `${pct}%`}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-sm text-secondary">{value === null ? '–' : `${pct}%`}</span>
    </div>
  );
}
