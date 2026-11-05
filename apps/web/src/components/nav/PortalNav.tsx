'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isActive, PORTAL_PRIMARY_HREF, portalItems } from './items';

/** Client portal navigation (D-018): bottom tab bar with a raised 56px brand "Train" button on phones; pills in the top bar from 768px up. */
export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Portal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:static md:border-0 md:bg-transparent md:pb-0 md:backdrop-blur-none"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5 md:flex md:gap-1">
        {portalItems.map((item) => {
          const active = isActive(pathname, item);
          const primary = item.href === PORTAL_PRIMARY_HREF;
          return (
            <li key={item.href} className="md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-micro transition-colors duration-[var(--k-motion-fast)] md:min-h-10 md:flex-row md:gap-2 md:rounded-md md:px-3 md:text-sm',
                  active
                    ? 'font-semibold text-brand md:bg-brand-soft md:text-brand-ink'
                    : 'text-secondary md:hover:bg-surface-2 md:hover:text-ink',
                )}
              >
                {primary ? (
                  <span
                    className={cn(
                      '-mt-7 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-e2 ring-4 ring-surface md:mt-0 md:size-auto md:bg-transparent md:text-current md:shadow-none md:ring-0',
                    )}
                  >
                    <item.icon aria-hidden className="size-6 md:size-5" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      'flex h-7 w-12 items-center justify-center rounded-full md:h-auto md:w-auto',
                      active && 'bg-brand-soft md:bg-transparent',
                    )}
                  >
                    <item.icon aria-hidden className="size-5" />
                  </span>
                )}
                {primary ? (
                  <>
                    {/* Phones call the raised centre action "Train"; the desktop bar says "Workouts". */}
                    <span className="max-w-full truncate md:hidden">Train</span>
                    <span className="hidden max-w-full truncate md:inline">{item.label}</span>
                  </>
                ) : (
                  <span className="max-w-full truncate">{item.label}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
