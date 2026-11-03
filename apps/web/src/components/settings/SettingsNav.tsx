'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsGroup {
  id: string;
  label: string;
}

/**
 * "On this page" for Settings: a sticky list beside the sections from 1024px up, a scrolling chip row above them
 * below that. Plain in-page links; the one whose group is on screen is marked current.
 */
export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const [current, setCurrent] = useState(groups[0]?.id);
  useEffect(() => {
    const els = groups
      .map((g) => document.getElementById(g.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-8">
      <p className="mb-2 hidden px-3 text-xs font-medium text-secondary lg:block">On this page</p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {groups.map((g) => {
          const active = current === g.id;
          return (
            <li key={g.id} className="shrink-0">
              <a
                href={`#${g.id}`}
                onClick={() => setCurrent(g.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-[var(--k-motion-fast)] lg:flex lg:rounded-control lg:border-0',
                  active
                    ? 'border-transparent bg-accent-soft font-medium text-accent-ink'
                    : 'border-border bg-surface text-secondary hover:text-ink lg:bg-transparent lg:hover:bg-surface-muted',
                )}
              >
                {g.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
