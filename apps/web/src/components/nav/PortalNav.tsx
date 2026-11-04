'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isActive, PORTAL_PRIMARY_HREF, portalItems } from './items';

/** Client portal navigation: bottom tab bar with a raised centre Workouts button on phones, inline in the top bar from 768px up. */
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
                    ? 'font-semibold text-accent-ink md:bg-accent-soft'
                    : 'text-secondary md:hover:bg-surface-2 md:hover:text-ink',
                )}
              >
                {primary ? (
                  <span
                    className={cn(
                      '-mt-6 flex size-12 items-center justify-center rounded-full bg-accent-fill text-on-accent shadow-e2 ring-4 ring-surface md:mt-0 md:size-auto md:bg-transparent md:shadow-none md:ring-0',
                      active ? 'md:text-accent' : 'md:text-current',
                    )}
                  >
                    <item.icon aria-hidden className="size-6 md:size-5" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      'flex h-7 w-12 items-center justify-center rounded-full md:h-auto md:w-auto',
                      active && 'bg-accent-soft md:bg-transparent',
                    )}
                  >
                    <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
                  </span>
                )}
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
