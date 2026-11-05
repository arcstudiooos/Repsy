'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  ChevronsUpDown,
  ArrowLeftRight,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
} from 'lucide-react';
import { RepsyLogo, RepsyMark } from '@/components/brand/Logo';
import { CommandPalette } from '@/components/nav/CommandPalette';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Avatar } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  coachDesktopItems,
  coachMobileItems,
  coachNavGroups,
  coachSecondaryItems,
  isActive,
  type NavGroup,
  type NavItem,
} from './items';

export interface NavCounts {
  review: number;
  messages: number;
}

export interface NavUser {
  name: string;
  org: string | null;
  /** Two or more workspaces: the workspace header and the user menu offer "Switch workspace". */
  canSwitch: boolean;
}

const RAIL_KEY = 'repsy-rail';
const GROUP_KEY = (label: string) => `repsy-nav-${label.toLowerCase()}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Storage blocked: defaults apply.
  }
}
function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

/** A count after the label. It is part of the link's name ("Review 4"), so screen readers hear it too. */
function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="tabular ml-auto min-w-5 rounded-full bg-brand px-1.5 text-center text-micro leading-5 font-semibold text-on-brand">
      <span className="sr-only"> </span>
      {n > 99 ? '99+' : n}
    </span>
  );
}

function SideLink({
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
  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex min-h-11 items-center gap-3 rounded-md px-3 text-body transition-colors duration-[var(--k-motion-fast)] lg:min-h-10',
        active
          ? 'bg-surface font-semibold text-brand shadow-e1'
          : 'text-secondary hover:bg-surface-2 hover:text-ink',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn(
            'absolute top-2 bottom-2 w-[3px] rounded-r-full bg-brand',
            collapsed ? '-left-2' : '-left-3',
          )}
        />
      )}
      <item.icon aria-hidden className="size-5 shrink-0" />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
      {count !== undefined &&
        (collapsed ? (
          count > 0 && (
            <>
              <span
                aria-hidden
                className="absolute top-1.5 right-2 size-2 rounded-full bg-brand ring-2 ring-sidebar"
              />
              <span className="sr-only"> {count}</span>
            </>
          )
        ) : (
          <CountBadge n={count} />
        ))}
    </Link>
  );
  return collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link;
}

function Group({
  group,
  pathname,
  countOf,
  collapsed,
}: {
  group: NavGroup;
  pathname: string;
  countOf: (item: NavItem) => number | undefined;
  collapsed: boolean;
}) {
  const hasActive = group.items.some((i) => isActive(pathname, i));
  const [open, setOpen] = useState(!group.collapsible);
  useEffect(() => {
    if (!group.collapsible || !group.label) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
    setOpen(readStore(GROUP_KEY(group.label)) === 'open');
  }, [group.collapsible, group.label]);
  const shown = !group.collapsible || open || hasActive || collapsed;
  const id = `nav-group-${(group.label ?? 'main').toLowerCase()}`;
  return (
    <div className={cn(group.label && 'mt-4')}>
      {group.label &&
        !collapsed &&
        (group.collapsible ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-controls={id}
            onClick={() => {
              const next = !open;
              setOpen(next);
              writeStore(GROUP_KEY(group.label!), next ? 'open' : 'closed');
            }}
            className="label-micro flex min-h-8 w-full items-center gap-1 rounded-sm px-3 text-secondary hover:text-ink"
          >
            {group.label}
            <ChevronDown
              aria-hidden
              className={cn(
                'ml-auto size-4 transition-transform duration-[var(--k-motion-base)]',
                !shown && '-rotate-90',
              )}
            />
          </button>
        ) : (
          <p className="label-micro px-3 pb-1 text-secondary">{group.label}</p>
        ))}
      {group.label && collapsed && <div aria-hidden className="mx-3 mb-2 border-t border-border" />}
      <ul id={id} className={cn('flex flex-col gap-0.5', !shown && 'hidden')}>
        {group.items.map((item) => (
          <li key={item.href}>
            <SideLink item={item} pathname={pathname} count={countOf(item)} collapsed={collapsed} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The workspace name at the top of the rail. With two or more workspaces it opens the switcher (I4). */
function WorkspaceHeader({ user, collapsed }: { user?: NavUser; collapsed: boolean }) {
  const org = user?.org ?? 'Repsy';
  const body = (
    <>
      <RepsyMark className="size-8" />
      {!collapsed && (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-body font-semibold text-ink">{org}</span>
          <span className="block text-caption text-secondary">Repsy</span>
        </span>
      )}
      {!collapsed && user?.canSwitch && (
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-secondary" />
      )}
    </>
  );
  const cls = cn('flex h-16 items-center gap-3 rounded-md', collapsed ? 'justify-center' : 'px-2');
  if (!user?.canSwitch) return <div className={cls}>{body}</div>;
  return (
    <Link
      href="/select-org"
      className={cn(cls, 'transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-2')}
    >
      <span className="sr-only">Switch workspace, current: </span>
      {body}
    </Link>
  );
}

/** Profile, theme, workspace switch and sign-out, behind the user card (sidebar) or the avatar (mobile). */
function UserMenuBody({ user }: { user?: NavUser }) {
  return (
    <div className="flex flex-col gap-1">
      {user && (
        <div className="flex items-center gap-3 px-2 pb-2">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0 text-sm leading-tight">
            <p className="truncate font-semibold">{user.name}</p>
            {user.org && <p className="truncate text-secondary">{user.org}</p>}
          </div>
        </div>
      )}
      <Link
        href="/settings"
        className="flex min-h-11 items-center gap-3 rounded-control px-3 text-base text-ink hover:bg-surface-2"
      >
        <UserRound aria-hidden className="size-5 text-secondary" />
        Profile and settings
      </Link>
      {user?.canSwitch && (
        <Link
          href="/select-org"
          className="flex min-h-11 items-center gap-3 rounded-control px-3 text-base text-ink hover:bg-surface-2"
        >
          <ArrowLeftRight aria-hidden className="size-5 text-secondary" />
          Switch workspace
        </Link>
      )}
      <div className="my-1 border-t border-border" />
      <p className="label-micro px-3 pt-1 text-secondary">Theme</p>
      <ThemeToggle className="mx-1 mb-1" />
      <div className="my-1 border-t border-border" />
      <SignOutButton className="w-full justify-start px-3 text-secondary" />
    </div>
  );
}

/** Keeps the sign-out confirm dialog alive: interacting with it must not close (and unmount) the menu. */
const keepOpenForDialogs = (e: Event) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest('[role="dialog"], [role="alertdialog"]')) e.preventDefault();
};

function UserCard({ user, collapsed }: { user?: NavUser; collapsed: boolean }) {
  if (!user) return null;
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-md text-left transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-2',
          collapsed ? 'justify-center' : 'px-2',
        )}
      >
        <span className="sr-only">Account menu for {user.name}</span>
        <Avatar name={user.name} size="sm" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-sm leading-tight">
              <span className="block truncate font-medium text-ink">{user.name}</span>
              <span className="block truncate text-secondary">{user.org ?? 'Coach'}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-secondary" />
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'top'}
        align="start"
        className="w-72 p-2"
        onInteractOutside={keepOpenForDialogs}
      >
        <UserMenuBody user={user} />
      </PopoverContent>
    </Popover>
  );
}

function MobileTab({
  item,
  pathname,
  count,
  onMore,
}: {
  item: NavItem;
  pathname: string;
  count?: number;
  onMore?: () => void;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={
        onMore
          ? (e) => {
              e.preventDefault();
              onMore();
            }
          : undefined
      }
      className={cn(
        'relative flex min-h-16 flex-col items-center justify-center gap-1 text-micro transition-colors duration-[var(--k-motion-fast)]',
        active ? 'font-semibold text-brand' : 'text-secondary',
      )}
    >
      {active && <span aria-hidden className="absolute top-0 h-1 w-8 rounded-b-full bg-brand" />}
      <span className="relative flex h-7 w-12 items-center justify-center">
        <item.icon aria-hidden className="size-5" />
        {count !== undefined && count > 0 && (
          <span className="tabular absolute -top-1 right-1 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] leading-4 font-semibold text-on-brand">
            <span className="sr-only"> </span>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  );
}

/** "More" on phones: every page that isn't in the tab bar, plus the account menu, in a bottom sheet. */
function MoreSheet({
  open,
  onOpenChange,
  pathname,
  countOf,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
  countOf: (item: NavItem) => number | undefined;
  user?: NavUser;
}) {
  const inBar = new Set(coachMobileItems.map((i) => i.href));
  const rest = [...coachDesktopItems, ...coachSecondaryItems].filter((i) => !inBar.has(i.href));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] md:hidden" />
        <Dialog.Content
          onInteractOutside={keepOpenForDialogs}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-xl border-t border-border bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-e2 md:hidden"
        >
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
          <div className="mb-2 flex items-center justify-between">
            <Dialog.Title className="text-h2 font-semibold">More</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="flex size-11 items-center justify-center rounded-control text-secondary hover:bg-surface-2"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Every other page, and your account menu.
          </Dialog.Description>
          <ul className="grid grid-cols-2 gap-1">
            {rest.map((item) => {
              const active = isActive(pathname, item);
              const n = countOf(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-12 items-center gap-3 rounded-control px-3 text-base',
                      active ? 'bg-brand-soft font-semibold text-brand-ink' : 'hover:bg-surface-2',
                    )}
                  >
                    <item.icon aria-hidden className="size-5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {n !== undefined && <CountBadge n={n} />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 border-t border-border pt-3">
            <UserMenuBody user={user} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Coach navigation (D-018): a light rail from 768px up (248px, or a 72px icon rail; collapsed by default below
 * 1024px), and a top bar plus a bottom tab bar on phones.
 */
export function CoachNav({
  counts,
  user,
  switcher,
}: {
  counts?: NavCounts;
  user?: NavUser;
  /** Kept for callers; the workspace header and user menu now hold the switcher. */
  switcher?: ReactNode;
}) {
  void switcher;
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const saved = readStore(RAIL_KEY);
    const next = saved ? saved === 'collapsed' : window.innerWidth < 1024;
    document.documentElement.dataset.rail = next ? 'collapsed' : 'open';
    if (next) setCollapsed(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-time restore
  }, []);
  useEffect(() => setMoreOpen(false), [pathname]); // eslint-disable-line react-hooks/set-state-in-effect -- close on navigation
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.rail = next ? 'collapsed' : 'open';
    writeStore(RAIL_KEY, next ? 'collapsed' : 'open');
  };
  const countOf = (item: NavItem) => (item.badge && counts ? counts[item.badge] : undefined);
  const title =
    [...coachDesktopItems, ...coachSecondaryItems].find((i) => isActive(pathname, i))?.label ??
    'Repsy';
  return (
    <>
      <aside
        className={cn(
          'hidden border-r border-border bg-sidebar text-ink md:sticky md:top-0 md:flex md:h-dvh md:flex-col print:hidden',
          collapsed ? 'md:px-2' : 'md:px-3',
        )}
      >
        <WorkspaceHeader user={user} collapsed={collapsed} />
        <div className="mb-3">
          {collapsed ? (
            <div className="flex justify-center">
              <CommandPalette variant="icon" />
            </div>
          ) : (
            <CommandPalette />
          )}
        </div>
        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
          {coachNavGroups.map((group) => (
            <Group
              key={group.label ?? 'main'}
              group={group}
              pathname={pathname}
              countOf={countOf}
              collapsed={collapsed}
            />
          ))}
          <ul className="mt-auto flex flex-col gap-0.5 pt-4">
            {coachSecondaryItems.map((item) => (
              <li key={item.href}>
                <SideLink item={item} pathname={pathname} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </nav>
        <div
          className={cn(
            'flex items-center gap-1 border-t border-border py-2',
            collapsed && 'flex-col',
          )}
        >
          <div className="min-w-0 flex-1">
            <UserCard user={user} collapsed={collapsed} />
          </div>
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-secondary transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-2 hover:text-ink"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-5" />
              ) : (
                <PanelLeftClose aria-hidden className="size-5" />
              )}
            </button>
          </Tooltip>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-2 backdrop-blur md:hidden print:hidden">
        <Link
          href="/app"
          aria-label="Repsy home"
          className="flex size-11 items-center justify-center"
        >
          <RepsyMark className="size-7" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-h3 font-semibold">{title}</p>
        <CommandPalette variant="icon" hotkey={false} />
        {user && (
          <Popover>
            <PopoverTrigger className="flex size-11 items-center justify-center rounded-full">
              <span className="sr-only">Account menu for {user.name}</span>
              <Avatar name={user.name} size="sm" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2" onInteractOutside={keepOpenForDialogs}>
              <UserMenuBody user={user} />
            </PopoverContent>
          </Popover>
        )}
        {!user && <RepsyLogo size="sm" className="sr-only" />}
      </header>

      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        <ul className="grid grid-cols-5">
          {coachMobileItems.map((item) => (
            <li key={item.href}>
              <MobileTab
                item={item}
                pathname={pathname}
                count={countOf(item)}
                onMore={item.href === '/app/more' ? () => setMoreOpen(true) : undefined}
              />
            </li>
          ))}
        </ul>
      </nav>
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        pathname={pathname}
        countOf={countOf}
        user={user}
      />
    </>
  );
}
