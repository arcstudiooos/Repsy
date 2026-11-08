'use client';

import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RepsyMark } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';
import { LOOP, PLAN_CONTACT, PLANS, planMailto } from '@/content/marketing';
import { readPaused, reduced } from './motion';

export const NAV_LINKS = [
  { label: 'Features', href: '#promises' },
  { label: 'How it works', href: '#loop' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Compare', href: '#compare' },
  { label: 'Switch to Repsy', href: '#faq' },
];

/** Sticky nav: transparent at the top, translucent canvas with blur and a border once scrolled past 8px. */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-[background-color,border-color] duration-[240ms]',
        scrolled
          ? 'border-border bg-canvas/85 backdrop-blur-md'
          : 'border-transparent bg-transparent',
      )}
    >
      <div className="mk-container flex h-[68px] items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold" aria-label="Repsy home">
          <RepsyMark className="size-8" />
          <span className="mk-display text-xl font-bold">Repsy</span>
        </Link>
        <nav aria-label="Marketing" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1 text-[15px]">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-control px-3 py-2 text-secondary transition-colors hover:text-ink"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/login"
            className="hidden min-h-10 items-center rounded-control px-3 text-[15px] font-medium hover:bg-surface-2 sm:flex"
          >
            Log in
          </a>
          <a
            href="/signup"
            className="group flex min-h-10 items-center gap-1.5 rounded-[12px] bg-brand px-4 text-[15px] font-semibold text-on-brand shadow-e1 transition-colors hover:bg-brand-hover"
          >
            Start free trial
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-150 group-hover:translate-x-[3px]"
            />
          </a>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger
              aria-label="Menu"
              className="flex size-11 items-center justify-center rounded-control hover:bg-surface-2 lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-canvas p-5 text-ink lg:hidden">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="mk-display text-xl font-bold">Repsy</Dialog.Title>
                  <Dialog.Close
                    aria-label="Close menu"
                    className="flex size-11 items-center justify-center rounded-control hover:bg-surface-2"
                  >
                    <X aria-hidden className="size-5" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
                <ul className="mt-6 flex flex-col gap-1 text-lg">
                  {NAV_LINKS.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="flex min-h-12 items-center rounded-control px-3 hover:bg-surface-2"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                  <li>
                    <a
                      href="/login"
                      className="flex min-h-12 items-center rounded-control px-3 hover:bg-surface-2"
                    >
                      Log in
                    </a>
                  </li>
                </ul>
                <a
                  href="/signup"
                  className="mt-auto flex min-h-12 items-center justify-center rounded-[12px] bg-brand text-base font-semibold text-on-brand"
                >
                  Start your free 7-day trial
                </a>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}

/**
 * "The loop": keyboard-accessible tabs (arrow keys). Auto-advances every 6s until the visitor interacts, and never
 * under reduced motion or the pause toggle. Panels are passed in, so they stay server-rendered.
 */
export function LoopStepper({ panels }: { panels: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const touched = useRef(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const paused =
        touched.current ||
        document.documentElement.dataset.motion === 'paused' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!paused) setActive((a) => (a + 1) % LOOP.length);
    }, 6000);
    return () => clearInterval(id);
  }, []);
  const pick = (n: number, focus = false) => {
    touched.current = true;
    setActive(n);
    if (focus) tabs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const last = LOOP.length - 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      pick(active === last ? 0 : active + 1, true);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      pick(active === 0 ? last : active - 1, true);
    else if (e.key === 'Home') pick(0, true);
    else if (e.key === 'End') pick(last, true);
    else return;
    e.preventDefault();
  };
  const step = LOOP[active]!;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div>
        <div
          role="tablist"
          aria-label="Coaching week steps"
          aria-orientation="vertical"
          onKeyDown={onKey}
          className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible"
        >
          {LOOP.map((s, n) => {
            const on = n === active;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[n] = el;
                }}
                role="tab"
                id={`loop-tab-${s.id}`}
                aria-selected={on}
                aria-controls="loop-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => pick(n)}
                className={cn(
                  'relative flex min-h-12 shrink-0 items-center gap-3 rounded-[12px] border px-4 text-left transition-colors duration-[240ms]',
                  on
                    ? 'border-brand-soft bg-surface shadow-e1'
                    : 'border-transparent text-secondary hover:bg-surface hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'mk-display flex size-7 items-center justify-center rounded-md text-sm font-bold',
                    on ? 'bg-acid text-on-acid ring-1 ring-on-acid' : 'bg-surface-2 text-secondary',
                  )}
                >
                  {n + 1}
                </span>
                <span className="font-semibold">{s.label}</span>
                <span className={cn('hidden text-sm lg:inline', on ? 'text-secondary' : 'sr-only')}>
                  — {s.title}
                </span>
              </button>
            );
          })}
        </div>
        <div
          aria-hidden
          className="mt-4 hidden h-1 overflow-hidden rounded-full bg-surface-2 lg:block"
        >
          <div
            className="h-full origin-left rounded-full bg-brand transition-transform duration-[600ms]"
            style={{ transform: `scaleX(${(active + 1) / LOOP.length})` }}
          />
        </div>
      </div>
      <div
        id="loop-panel"
        role="tabpanel"
        aria-labelledby={`loop-tab-${step.id}`}
        tabIndex={0}
        className="rounded-[24px] border border-border bg-surface p-5 shadow-e1 md:p-6"
      >
        <div key={step.id} className="mk-panel-in">
          <h3 className="mk-display text-2xl font-semibold">{step.title}</h3>
          <ul className="mt-3 flex flex-col gap-2 text-secondary">
            {step.points.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-5">{panels[active]}</div>
        </div>
      </div>
    </div>
  );
}

/** Monthly / annual toggle with the plan cards (prices switch; annual shows the saving). */
export function PricingPlans() {
  const [annual, setAnnual] = useState(false);
  return (
    <div>
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-full border border-border bg-surface p-1 shadow-e1"
        >
          {(['Monthly', 'Annual'] as const).map((label) => {
            const on = (label === 'Annual') === annual;
            return (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setAnnual(label === 'Annual')}
                className={cn(
                  'min-h-11 rounded-full px-5 text-sm font-semibold transition-colors duration-[240ms]',
                  on ? 'bg-ink text-canvas' : 'text-secondary hover:text-ink',
                )}
              >
                {label}
                {label === 'Annual' && (
                  <span
                    className={cn(
                      'ml-2 rounded-full px-2 py-0.5 text-[11px]',
                      on ? 'bg-acid text-on-acid' : 'bg-acid-soft text-acid-ink',
                    )}
                  >
                    2 months free
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p, n) => {
          const featured = 'featured' in p && p.featured;
          const trial = p.monthly === 0;
          const price = annual ? Math.round(p.annual / 12) : p.monthly;
          return (
            <li
              key={p.id}
              data-reveal
              style={{ '--mk-i': n } as React.CSSProperties}
              className={cn(
                'relative flex flex-col rounded-[16px] p-6',
                featured
                  ? 'bg-ink text-canvas shadow-e2'
                  : 'border border-border bg-surface shadow-e1',
              )}
            >
              {featured && (
                <span
                  aria-hidden
                  className="mk-ants pointer-events-none absolute inset-0 rounded-[16px]"
                />
              )}
              <div className="flex items-center justify-between">
                <h3 className="mk-display text-2xl font-semibold">{p.name}</h3>
                {featured && (
                  <span className="rounded-full bg-acid px-2.5 py-1 text-[11px] font-semibold text-on-acid">
                    Most coaches
                  </span>
                )}
              </div>
              <p className={cn('mt-1 text-sm', featured ? 'text-canvas/80' : 'text-secondary')}>
                {p.blurb}
              </p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="mk-display tabular text-5xl font-bold">${price}</span>
                <span className={cn('text-sm', featured ? 'text-canvas/80' : 'text-secondary')}>
                  {trial ? 'for 7 days' : '/month'}
                </span>
              </p>
              <p
                className={cn(
                  'mt-1 h-5 text-[13px]',
                  featured ? 'text-canvas/80' : 'text-secondary',
                )}
              >
                {annual && p.annual > 0
                  ? `$${p.annual.toLocaleString('en-US')} billed yearly`
                  : p.monthly === 0
                    ? 'No card needed'
                    : 'Billed monthly'}
              </p>
              <ul
                className={cn(
                  'mt-5 flex flex-col gap-1.5 text-sm',
                  featured ? 'text-canvas/90' : 'text-ink',
                )}
              >
                <li>
                  <strong className="tabular">{p.clients}</strong> active clients
                </li>
                <li>
                  <strong className="tabular">{p.seats}</strong> coach{' '}
                  {p.seats === 1 ? 'seat' : 'seats'}
                </li>
                <li>Every feature included</li>
              </ul>
              <a
                href={trial ? '/signup' : planMailto(p.name)}
                className={cn(
                  'mt-6 flex min-h-12 items-center justify-center rounded-[12px] text-[15px] font-semibold transition-colors',
                  featured
                    ? 'bg-acid text-on-acid hover:brightness-95'
                    : 'border border-input-border bg-surface text-ink hover:bg-surface-2',
                )}
              >
                {trial ? 'Start free trial' : `Email us for ${p.name}`}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-secondary">
        Online checkout is coming soon. Until then, start the free trial and email{' '}
        <a href={`mailto:${PLAN_CONTACT}`} className="underline underline-offset-4">
          {PLAN_CONTACT}
        </a>{' '}
        to move your workspace to a paid plan.
      </p>
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Hero 3D stage: the product mockups sit on layers at different depths (CSS `translate` Z on `.mk-z*`) inside a
 * `preserve-3d` plane. The plane leans back while it sits low in the viewport and flattens as it scrolls up; on a fine
 * pointer it also turns toward the cursor. JS only writes two custom properties (`--mk-rx`, `--mk-ry`) that drive a
 * transform, eased in one rAF loop that stops once settled. No motion at all under reduced motion or when the visitor
 * paused motion (the CSS is gated too, so the stage renders flat without JS).
 */
export function DepthStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const area = el.closest('section') ?? el;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const cur = { rx: 10, ry: 0 };
    let px = 0;
    let py = 0;
    let raf = 0;
    const target = () => {
      if (readPaused()) return { rx: 0, ry: 0 };
      const top = el.getBoundingClientRect().top;
      const lean = clamp(top / (window.innerHeight || 1), 0, 1) * 12;
      return { rx: lean - py * 6, ry: px * 10 };
    };
    const frame = () => {
      const t = target();
      cur.rx += (t.rx - cur.rx) * 0.12;
      cur.ry += (t.ry - cur.ry) * 0.12;
      el.style.setProperty('--mk-rx', `${cur.rx.toFixed(2)}deg`);
      el.style.setProperty('--mk-ry', `${cur.ry.toFixed(2)}deg`);
      const moving = Math.abs(t.rx - cur.rx) > 0.02 || Math.abs(t.ry - cur.ry) > 0.02;
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = area.getBoundingClientRect();
      px = clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
      py = clamp((e.clientY - r.top) / r.height - 0.5, -0.5, 0.5);
      kick();
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      kick();
    };
    if (fine) {
      area.addEventListener('pointermove', onMove as EventListener, { passive: true });
      area.addEventListener('pointerleave', onLeave);
    }
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick);
    window.addEventListener('repsy-motion', kick);
    kick();
    return () => {
      cancelAnimationFrame(raf);
      area.removeEventListener('pointermove', onMove as EventListener);
      area.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', kick);
      window.removeEventListener('repsy-motion', kick);
    };
  }, []);
  return (
    <div ref={ref} className={cn('mk-stage', className)}>
      {children}
    </div>
  );
}

/**
 * A list whose `.mk-tilt` items turn toward a fine pointer (up to 6deg) with a soft glare that follows it. One
 * delegated listener; it writes custom properties only (`rotate` + a gradient position), never layout.
 */
export function TiltList({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    if (!list || reduced() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches)
      return;
    let active: HTMLElement | null = null;
    const reset = (card: HTMLElement | null) => {
      if (!card) return;
      const axis = card.style.getPropertyValue('--mk-axis') || '0 1 0';
      card.style.setProperty('--mk-tilt', `${axis} 0deg`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const card = (e.target as Element).closest<HTMLElement>('.mk-tilt');
      if (card !== active) {
        reset(active);
        active = card;
      }
      if (!card || readPaused()) return;
      const r = card.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      const ax = -(y - 0.5);
      const ay = x - 0.5;
      const len = Math.hypot(ax, ay) || 1;
      const axis = `${(ax / len).toFixed(3)} ${(ay / len).toFixed(3)} 0`;
      card.style.setProperty('--mk-axis', axis);
      card.style.setProperty('--mk-tilt', `${axis} ${(len * 8.5).toFixed(2)}deg`);
      card.style.setProperty('--mk-gx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--mk-gy', `${(y * 100).toFixed(1)}%`);
    };
    const onLeave = () => {
      reset(active);
      active = null;
    };
    list.addEventListener('pointermove', onMove as EventListener, { passive: true });
    list.addEventListener('pointerleave', onLeave);
    return () => {
      list.removeEventListener('pointermove', onMove as EventListener);
      list.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <ul ref={ref} className={cn('mk-tilt-list', className)}>
      {children}
    </ul>
  );
}
