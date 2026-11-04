import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A filter as a chip link (URL-driven), with an optional icon and count. The active one has aria-current. */
export function FilterChip({
  href,
  active,
  icon: Icon,
  count,
  children,
}: {
  href: string;
  active: boolean;
  icon?: LucideIcon;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm whitespace-nowrap transition-colors duration-[var(--k-motion-fast)] md:min-h-9',
        active
          ? 'border-transparent bg-accent-soft font-medium text-accent-ink'
          : 'border-border bg-surface text-secondary hover:border-input-border hover:text-ink',
      )}
    >
      {Icon && <Icon aria-hidden className="size-4" />}
      {children}
      {count !== undefined && (
        <span className="tabular rounded-full bg-surface-2 px-1.5 text-caption text-secondary">
          {count}
        </span>
      )}
    </Link>
  );
}

/** A row of chips that scrolls sideways on phones and wraps from 768px up. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      {children}
    </nav>
  );
}
