'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { applyChoice, readChoice, THEME_EVENT, type ThemeChoice } from './theme';

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Light / Dark / System, as a radio group. Lives in the coach user menu and the portal Profile. */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, readChoice, () => 'system');
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex gap-1 rounded-md bg-surface-2 p-1', className)}
    >
      {OPTIONS.map((o) => {
        const on = choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => applyChoice(o.value)}
            className={cn(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-caption font-medium transition-colors duration-[var(--k-motion-fast)] md:min-h-9',
              on ? 'bg-surface text-ink shadow-e1' : 'text-secondary hover:text-ink',
            )}
          >
            <o.icon aria-hidden className="size-4" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
