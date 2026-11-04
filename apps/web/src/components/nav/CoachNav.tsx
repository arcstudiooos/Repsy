'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, Palette } from 'lucide-react';
import { RepsyLogo, RepsyMark } from '@/components/brand/Logo';
import { CommandPalette } from '@/components/nav/CommandPalette';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Avatar } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  coachDesktopItems,
  coachMobileItems,
  coachSettingsItem,
  isActive,
  type NavItem,
} from './items';

export interface NavCounts {
  review: number;
  messages: number;
}

const RAIL_KEY = 'repsy-rail';

/** A count after the label. It is part of the link's name ("Review 4"), so screen readers hear it too. */
function CountBadge({ n, onDark }: { n: number; onDark?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'tabular ml-auto min-w-5 rounded-full px-1.5 text-center text-micro leading-5 font-semibold',
        onDark ? 'bg-ember text-midnight' : 'bg-accent-fill text-on-accent',
      )}
    >
      <span className="sr-only"> </span>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function DesktopLink({
  item,
  pathname,
  count,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  count?: number;
  collapsed: boolean;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-[0.9375rem] transition-colors duration-[var(--k-motion-fast)]',
        active
          ? 'bg-accent-soft font-semibold text-accent-ink'
          : 'text-on-midnight-muted hover:bg-midnight-2 hover:text-on-midnight',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <span aria-hidden className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-ember" />
      )}
      <item.icon aria-hidden className={cn('size-5 shrink-0', active && 'text-accent')} />
      <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
      {count !== undefined &&
        (collapsed ? (
          count > 0 && (
            <span
              aria-hidden
              className="absolute top-1.5 right-2 size-2 rounded-full bg-ember ring-2 ring-midnight"
            />
          )
        ) : (
          <CountBadge n={count} onDark={!active} />
        ))}
      {collapsed && count !== undefined && count > 0 && <span className="sr-only"> {count}</span>}
    </Link>
  );
}

function MobileLink({
  item,
  pathname,
  count,
}: {
  item: NavItem;
  pathname: string;
  count?: number;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-14 flex-col items-center justify-center gap-1 text-micro transition-colors duration-[var(--k-motion-fast)]',
        active ? 'font-semibold text-accent-ink' : 'text-secondary',
      )}
    >
      <span
        className={cn(
          'relative flex h-7 w-12 items-center justify-center rounded-full',
          active && 'bg-accent-soft',
        )}
      >
        <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
        {count !== undefined && count > 0 && (
          <span className="tabular absolute -top-1 right-1 min-w-4 rounded-full bg-accent-fill px-1 text-center text-[10px] leading-4 font-semibold text-on-accent">
            <span className="sr-only"> </span>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  );
}

/** Coach navigation: midnight rail from 768px up (collapsible to icons), bottom tab bar below. */
export function CoachNav({
  switcher,
  counts,
  user,
}: {
  switcher?: ReactNode;
  counts?: NavCounts;
  user?: { name: string; org: string | null };
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RAIL_KEY) === 'collapsed';
      document.documentElement.dataset.rail = saved ? 'collapsed' : 'open';
      if (saved) setCollapsed(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time restore from storage
    } catch {
      // Storage blocked: stays open.
    }
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.rail = next ? 'collapsed' : 'open';
    try {
      window.localStorage.setItem(RAIL_KEY, next ? 'collapsed' : 'open');
    } catch {
      // Not remembered.
    }
  };
  const countOf = (item: NavItem) => (item.badge && counts ? counts[item.badge] : undefined);
  return (
    <>
      <aside
        className={cn(
          'hidden bg-midnight text-on-midnight md:sticky md:top-0 md:flex md:h-dvh md:flex-col print:hidden',
          collapsed ? 'md:px-2' : 'md:px-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 pt-5 pb-4',
            collapsed ? 'flex-col px-0' : 'justify-between px-3',
          )}
        >
          {collapsed ? <RepsyMark title="Repsy" /> : <RepsyLogo tone="light" />}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex size-9 items-center justify-center rounded-md text-on-midnight-muted hover:bg-midnight-2 hover:text-on-midnight"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </button>
        </div>
        <div className={collapsed ? 'hidden' : 'mb-3 px-0.5'}>
          <CommandPalette />
        </div>
        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
          <ul className="flex flex-col gap-0.5">
            {coachDesktopItems.map((item) => (
              <li key={item.href}>
                <DesktopLink
                  item={item}
                  pathname={pathname}
                  count={countOf(item)}
                  collapsed={collapsed}
                />
              </li>
            ))}
          </ul>
          <ul className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3">
            <li>
              <DesktopLink item={coachSettingsItem} pathname={pathname} collapsed={collapsed} />
            </li>
          </ul>
          {!collapsed && switcher}
        </nav>
        <div
          className={cn(
            'flex items-center gap-1 border-t border-white/10 py-3',
            collapsed ? 'flex-col' : 'px-1',
          )}
        >
          {user && (
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2.5',
                collapsed && 'justify-center',
              )}
            >
              <Avatar name={user.name} size="sm" />
              {!collapsed && (
                <div className="min-w-0 text-sm leading-tight">
                  <p className="truncate font-medium text-on-midnight">{user.name}</p>
                  {user.org && <p className="truncate text-on-midnight-muted">{user.org}</p>}
                </div>
              )}
            </div>
          )}
          <Popover>
            <PopoverTrigger
              aria-label="Theme"
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-on-midnight-muted hover:bg-midnight-2 hover:text-on-midnight"
            >
              <Palette aria-hidden className="size-5" />
            </PopoverTrigger>
            <PopoverContent side="top" className="w-auto">
              <p className="mb-2 text-sm font-medium">Theme</p>
              <ThemeToggle />
            </PopoverContent>
          </Popover>
          <SignOutButton
            iconOnly
            className="size-10 shrink-0 px-0 text-on-midnight-muted hover:bg-midnight-2 hover:text-on-midnight"
          />
        </div>
      </aside>
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        <ul className="grid grid-cols-5">
          {coachMobileItems.map((item) => (
            <li key={item.href}>
              <MobileLink item={item} pathname={pathname} count={countOf(item)} />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
