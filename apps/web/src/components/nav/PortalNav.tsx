'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isActive, portalItems } from './items';

/** Client portal navigation: bottom bar on mobile, top bar from 768px up. */
export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Portal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:static md:border-t-0 md:border-b md:bg-surface md:pb-0 md:backdrop-blur-none"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5 md:flex md:gap-1 md:px-5">
        {portalItems.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="md:flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs transition-colors duration-[var(--k-motion-fast)] md:my-1.5 md:min-h-10 md:flex-row md:gap-2 md:rounded-control md:px-3 md:text-[0.9375rem]',
                  active
                    ? 'font-semibold text-accent-ink md:bg-accent-soft'
                    : 'text-secondary md:hover:bg-surface-muted md:hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full md:contents',
                    active && 'bg-accent-soft',
                  )}
                >
                  <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
