'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * A rest countdown after a saved set (PRD D6). It counts down from the target's rest (or 90 s), can be extended or
 * skipped, vibrates where the device allows when it ends, and never animates (reduced-motion safe). The time is a
 * timer role without live announcements; the end is announced once.
 */
export function RestTimer({
  endsAt,
  label,
  onExtend,
  onDone,
}: {
  endsAt: number;
  label: string;
  onExtend: (seconds: number) => void;
  onDone: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left === 0) navigator.vibrate?.(200);
  }, [left]);

  return (
    <div
      role="region"
      aria-label="Rest timer"
      className="sticky bottom-20 z-30 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-input-border bg-surface p-3 shadow-card md:bottom-4"
    >
      <p className="flex flex-col">
        <span className="text-sm text-secondary">{label}</span>
        {left > 0 ? (
          <span role="timer" className="text-2xl font-semibold tabular-nums">
            {fmt(left)}
          </span>
        ) : (
          <span role="status" className="text-lg font-semibold text-accent">
            Rest done. Next set.
          </span>
        )}
      </p>
      <div className="flex gap-2">
        {left > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onExtend(30)}>
            +30 s
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {left > 0 ? 'Skip rest' : 'Close'}
        </Button>
      </div>
    </div>
  );
}
