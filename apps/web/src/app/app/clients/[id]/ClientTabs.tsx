'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Program', segment: 'program' },
  { label: 'Sessions', segment: 'sessions' },
  { label: 'Calendar', segment: 'calendar' },
  { label: 'Progress', segment: 'progress' },
  { label: 'Habits', segment: 'habits' },
  { label: 'Nutrition', segment: 'nutrition' },
  { label: 'Check-ins', segment: 'check-ins' },
  { label: 'Messages', segment: 'messages' },
  { label: 'Notes', segment: 'notes' },
  { label: 'History', segment: 'history' },
] as const;

/** Route-based tabs: plain links, so they are keyboard reachable and scroll sideways on mobile. */
export function ClientTabs({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const base = `/app/clients/${clientId}`;
  return (
    <nav aria-label="Client sections" className="overflow-x-auto border-b border-divider">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = pathname === href;
          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-2 px-4 text-base font-medium whitespace-nowrap transition-colors duration-[var(--k-motion-fast)]',
                  active
                    ? 'border-accent text-ink'
                    : 'border-transparent text-secondary hover:text-ink',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
