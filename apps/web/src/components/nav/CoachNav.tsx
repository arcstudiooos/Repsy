'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SignOutButton } from '@/components/nav/SignOutButton';
import {
  coachDesktopItems,
  coachMobileItems,
  coachSettingsItem,
  isActive,
  type NavItem,
} from './items';
import { RepsyLogo } from '@/components/brand/Logo';

function DesktopLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-control px-3 text-base transition-colors duration-[var(--k-motion-fast)]',
        active
          ? 'bg-canvas font-semibold text-ink'
          : 'text-secondary hover:bg-canvas hover:text-ink',
      )}
    >
      <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
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
        'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-[var(--k-motion-fast)]',
        active ? 'font-semibold text-ink' : 'text-secondary',
      )}
    >
      <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
      {item.label}
    </Link>
  );
}

/** Coach navigation: left rail from 768px up, bottom bar below. */
export function CoachNav({ switcher }: { switcher?: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <aside className="hidden border-r border-divider bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-y-auto md:p-4 print:hidden">
        <p className="mb-6 px-3">
          <RepsyLogo />
        </p>
        <nav aria-label="Primary" className="flex flex-1 flex-col">
          <ul className="flex flex-col gap-1">
            {coachDesktopItems.map((item) => (
              <li key={item.href}>
                <DesktopLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
          <ul className="mt-auto flex flex-col gap-1 pt-4">
            <li>
              <DesktopLink item={coachSettingsItem} pathname={pathname} />
            </li>
          </ul>
          {switcher}
        </nav>
        <div className="mt-2 border-t border-divider pt-4">
          <SignOutButton />
        </div>
      </aside>
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface md:hidden print:hidden"
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
