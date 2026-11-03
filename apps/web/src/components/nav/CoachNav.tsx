'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { BrandMark } from '@/components/nav/BrandMark';
import {
  coachDesktopItems,
  coachMobileItems,
  coachSettingsItem,
  isActive,
  type NavItem,
} from './items';

function DesktopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex min-h-[2.125rem] items-center gap-3 rounded-control px-2.5 text-[0.9375rem] transition-colors duration-[var(--k-motion-fast)]',
        active
          ? 'bg-accent-soft font-semibold text-accent-ink'
          : 'text-secondary hover:bg-surface-muted hover:text-ink',
      )}
    >
      <item.icon
        aria-hidden
        className={cn(
          'size-[1.125rem] shrink-0',
          active ? 'text-accent' : 'text-secondary/80 group-hover:text-ink',
        )}
      />
      {item.label}
    </Link>
  );
}

function MobileLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors duration-[var(--k-motion-fast)]',
        active ? 'font-semibold text-accent-ink' : 'text-secondary',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[var(--k-motion-fast)]',
          active && 'bg-accent-soft',
        )}
      >
        <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
      </span>
      {item.label}
    </Link>
  );
}

/** Items grouped by their sidebar heading, keeping the declared order. */
function groups(items: NavItem[]): Array<{ name: string; items: NavItem[] }> {
  const out: Array<{ name: string; items: NavItem[] }> = [];
  for (const item of items) {
    const name = item.group ?? '';
    const last = out[out.length - 1];
    if (last && last.name === name) last.items.push(item);
    else out.push({ name, items: [item] });
  }
  return out;
}

/** Coach navigation: left rail from 768px up, bottom bar below. */
export function CoachNav({ switcher, identity }: { switcher?: ReactNode; identity?: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <aside className="hidden border-r border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col print:hidden">
        <div className="px-5 pt-4 pb-3">
          <BrandMark />
        </div>
        <nav
          aria-label="Primary"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3"
        >
          {groups(coachDesktopItems).map((group) => (
            <div key={group.name} className="mb-3 last:mb-0">
              {group.name && (
                <p
                  id={`nav-${group.name.toLowerCase()}`}
                  className="mb-1 px-2.5 text-xs font-medium text-secondary"
                >
                  {group.name}
                </p>
              )}
              <ul
                aria-labelledby={group.name ? `nav-${group.name.toLowerCase()}` : undefined}
                className="flex flex-col gap-0.5"
              >
                {group.items.map((item) => (
                  <li key={item.href}>
                    <DesktopLink item={item} pathname={pathname} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="mt-auto flex flex-col gap-0.5 border-t border-divider pt-3">
            <li>
              <DesktopLink item={coachSettingsItem} pathname={pathname} />
            </li>
          </ul>
          {switcher}
        </nav>
        <div className="flex items-center gap-1 border-t border-divider p-3">
          <div className="min-w-0 flex-1">{identity}</div>
          <SignOutButton iconOnly className="size-10 shrink-0 px-0 text-secondary" />
        </div>
      </aside>
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        <ul className="grid grid-cols-5">
          {coachMobileItems.map((item) => (
            <li key={item.href}>
              <MobileLink item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
