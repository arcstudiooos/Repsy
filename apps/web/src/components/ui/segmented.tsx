'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const wrap = 'inline-flex w-fit max-w-full gap-1 overflow-x-auto rounded-md bg-surface-2 p-1';
const item =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--k-motion-fast)] md:min-h-9';
const on = 'bg-surface text-ink shadow-e1';
const off = 'text-secondary hover:text-ink';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown after the label, e.g. a count. */
  count?: number;
}

/** A segmented control of buttons (a radio group). For URL-driven filters use SegmentedLinks. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn(wrap, className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(item, o.value === value ? on : off)}
        >
          {o.label}
          {o.count !== undefined && <Count n={o.count} />}
        </button>
      ))}
    </div>
  );
}

/** The same look as links (navigation between filtered views); the current one has aria-current. */
export function SegmentedLinks({
  options,
  label,
  className,
}: {
  options: Array<{ href: string; label: ReactNode; current: boolean; count?: number }>;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn(wrap, className)}>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.current ? 'page' : undefined}
          className={cn(item, o.current ? on : off)}
        >
          {o.label}
          {o.count !== undefined && <Count n={o.count} />}
        </Link>
      ))}
    </nav>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="tabular rounded-full bg-surface-2 px-1.5 text-caption text-secondary">
      {n}
    </span>
  );
}
