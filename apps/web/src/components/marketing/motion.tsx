'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

const PAUSE_KEY = 'repsy-motion';
const IDLE_MS = 30_000;
const SELECTOR =
  '[data-reveal], [data-draw], [data-grow], [data-cascade], .mk-marker, .mk-sync, [data-count]';

export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function readPaused(): boolean {
  try {
    return window.localStorage.getItem(PAUSE_KEY) === 'paused';
  } catch {
    return false;
  }
}

/** Counts a number up from 0 once (the final value is already in the HTML; this text is aria-hidden). */
function countUp(el: HTMLElement) {
  const end = Number(el.dataset.count);
  if (!Number.isFinite(end) || reduced()) return;
  const from = Number(el.dataset.from ?? 0);
  const prefix = el.dataset.prefix ?? '';
  const suffix = el.dataset.suffix ?? '';
  const fmt = (n: number) => `${prefix}${Math.round(n).toLocaleString('en-US')}${suffix}`;
  const start = performance.now();
  const dur = 900;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = fmt(from + (end - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  el.textContent = fmt(from);
  requestAnimationFrame(tick);
}

/**
 * Landing PRD §10.5: one IntersectionObserver marks elements `data-inview` (CSS does the entrance), counters count
 * up once, and ambient loops pause when the visitor asks, the tab is hidden, or after 30s idle (WCAG 2.2.2).
 */
export function MotionController() {
  useEffect(() => {
    const root = document.documentElement;
    // The inline boot script sets this before paint; re-add it after a remount (React Strict Mode runs the cleanup).
    root.classList.add('mk-js');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.dataset.inview = '';
          if (el.dataset.count !== undefined) countUp(el);
          io.unobserve(el);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => io.observe(el));

    let idle: ReturnType<typeof setTimeout>;
    const apply = () => {
      const paused = readPaused() || document.hidden || root.dataset.idle === '1';
      root.dataset.motion = paused ? 'paused' : 'on';
    };
    const wake = () => {
      clearTimeout(idle);
      if (root.dataset.idle === '1') {
        delete root.dataset.idle;
        apply();
      }
      idle = setTimeout(() => {
        root.dataset.idle = '1';
        apply();
      }, IDLE_MS);
    };
    apply();
    wake();
    const events = ['pointermove', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
    document.addEventListener('visibilitychange', apply);
    window.addEventListener('repsy-motion', apply);
    return () => {
      io.disconnect();
      clearTimeout(idle);
      events.forEach((ev) => window.removeEventListener(ev, wake));
      document.removeEventListener('visibilitychange', apply);
      window.removeEventListener('repsy-motion', apply);
      root.classList.remove('mk-js');
      delete root.dataset.motion;
      delete root.dataset.idle;
    };
  }, []);
  return null;
}

/** "Pause motion" (bottom-left, 44px): stops every ambient loop; remembered per device. */
export function MotionPauseToggle() {
  const [paused, setPaused] = useState(false);
  useEffect(() => setPaused(readPaused()), []); // eslint-disable-line react-hooks/set-state-in-effect -- restore once
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      window.localStorage.setItem(PAUSE_KEY, next ? 'paused' : 'on');
    } catch {
      // Not remembered; still applies for this page.
      document.documentElement.dataset.motion = next ? 'paused' : 'on';
    }
    window.dispatchEvent(new Event('repsy-motion'));
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={paused}
      className="group fixed bottom-4 left-4 z-50 flex size-11 items-center gap-2 overflow-hidden rounded-full border border-border bg-surface px-3 text-caption font-medium text-ink shadow-e1 transition-[width] focus-visible:w-auto hover:w-auto"
    >
      {paused ? (
        <Play aria-hidden className="size-4 shrink-0" />
      ) : (
        <Pause aria-hidden className="size-4 shrink-0" />
      )}
      <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
        {paused ? 'Play motion' : 'Pause motion'}
      </span>
      <span className="sr-only">{paused ? ', motion is paused' : ''}</span>
    </button>
  );
}
