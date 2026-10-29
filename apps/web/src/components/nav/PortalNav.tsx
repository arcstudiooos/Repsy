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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface md:static md:border-t-0 md:border-b"
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
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-[var(--k-motion-fast)] md:min-h-11 md:flex-row md:gap-2 md:rounded-control md:px-3 md:text-base',
                  active
                    ? 'font-semibold text-ink md:bg-canvas'
                    : 'text-secondary md:hover:bg-canvas md:hover:text-ink',
                )}
              >
                <item.icon aria-hidden className={cn('size-5', active && 'text-accent')} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
