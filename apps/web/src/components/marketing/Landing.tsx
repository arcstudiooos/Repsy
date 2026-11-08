import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Bricolage_Grotesque } from 'next/font/google';
import {
  ArrowRight,
  CalendarClock,
  Check,
  CreditCard,
  FileDown,
  Lock,
  Minus,
  Play,
  Accessibility,
  Plus,
  Activity,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { RepsyMark } from '@/components/brand/Logo';
import { CookieSettingsLink, MarketingAnalytics } from './MarketingAnalytics';
import { cn } from '@/lib/utils';
import {
  COMPARE_ROWS,
  COMPETITORS,
  FAQ,
  INCLUDED,
  LOOP,
  PROMISES,
  REPSY_CELLS,
  SWITCH_FROM,
  TOUR_VIDEO,
  TRUST,
} from '@/content/marketing';
import {
  AcidTabs,
  Aurora,
  DotGrid,
  Grain,
  LogGrid,
  OutlineNumeral,
  PlateRings,
  RulerTicks,
  TrendLine,
  Wordmark,
} from './bg';
import { DepthStage, LoopStepper, MarketingNav, PricingPlans, TiltList } from './islands';
import { DashboardMock, Num, PhoneLogger, PrCard, SyncPill, FloatCard } from './mocks';
import { MotionController, MotionPauseToggle } from './motion';
import './marketing.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-bricolage',
  display: 'swap',
});

const i = (n: number) => ({ '--mk-i': n }) as CSSProperties;

/** Opts into entrance animations before first paint; without JS everything shows in its final state. */
const motionBoot = `document.documentElement.classList.add('mk-js')`;

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mk-eyebrow text-secondary', className)}>{children}</p>;
}

function H2({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <h2
      id={id}
      data-reveal
      className={cn('mk-display text-[34px] font-semibold md:text-[48px]', className)}
    >
      {children}
    </h2>
  );
}

function PrimaryCta({
  children,
  href = '/signup',
  tone = 'brand',
}: {
  children: ReactNode;
  href?: string;
  tone?: 'brand' | 'acid';
}) {
  return (
    <a
      href={href}
      className={cn(
        'group inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] px-6 text-base font-semibold shadow-e1 transition-colors',
        tone === 'acid'
          ? 'bg-acid text-on-acid ring-1 ring-on-acid/20 hover:brightness-95'
          : 'bg-brand text-on-brand hover:bg-brand-hover',
      )}
    >
      {children}
      <ArrowRight
        aria-hidden
        className="size-4 transition-transform duration-150 group-hover:translate-x-[3px]"
      />
    </a>
  );
}

function SecondaryCta({
  children,
  href,
  onDark,
}: {
  children: ReactNode;
  href: string;
  onDark?: boolean;
}) {
  return (
    <a
      href={href}
      className={cn(
        'inline-flex min-h-12 items-center justify-center rounded-[12px] border px-6 text-base font-semibold transition-colors',
        onDark
          ? 'border-on-midnight/40 text-on-midnight hover:bg-midnight-2'
          : 'border-input-border bg-surface text-ink hover:bg-surface-2',
      )}
    >
      {children}
    </a>
  );
}

/* ---------- 2. Hero ---------- */
function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mk-section !pt-10 md:!pt-16">
      <Aurora className="mk-aurora--hero" />
      <DotGrid />
      <PlateRings size={520} className="-top-40 -right-48 hidden md:block" />
      <AcidTabs
        spots={[
          { top: '14%', left: '6%' },
          { top: '62%', left: '3%', size: 10 },
          { top: '20%', left: '92%', size: 14 },
        ]}
      />
      <div className="mk-container">
        <div className="max-w-5xl">
          <Eyebrow className="k-fade-up">Online coaching software</Eyebrow>
          <h1 id="hero-title" className="mk-display mt-5 text-[46px] font-bold md:text-[84px]">
            <span data-reveal className="block">
              Coaching software that
            </span>
            {/* A real space: the spans are blocks, so without it the heading's text reads "thatnever". */}{' '}
            <span data-reveal style={i(1)} className="block">
              <span className="mk-marker">never drops the ball.</span>
            </span>
          </h1>
          <p
            data-reveal
            style={i(2)}
            className="mt-6 max-w-2xl text-[17px] leading-relaxed text-secondary md:text-[19px]"
          >
            Programs, check-ins, messages and scheduling in one place. Your clients&apos; logs save
            even with no signal, and every feature is on every plan.
          </p>
          <div data-reveal style={i(3)} className="mt-8 flex flex-wrap gap-3">
            <PrimaryCta>Start free with 3 clients</PrimaryCta>
            {tourReady ? (
              <SecondaryCta href="#tour">See a {TOUR_VIDEO.length} tour</SecondaryCta>
            ) : (
              <SecondaryCta href="#loop">See how it works</SecondaryCta>
            )}
          </div>
          <p data-reveal style={i(4)} className="mt-4 text-sm text-secondary">
            No card needed · Import clients from a spreadsheet · Export everything, any time
          </p>
        </div>

        <DepthStage className="relative mt-14 md:mt-20">
          <div className="mk-stage-inner relative">
            {/* Depth layer: the log grid and two glows sit far behind the mockups. */}
            <div aria-hidden className="mk-depth">
              <LogGrid />
              <Aurora />
            </div>
            <div className="mk-3d relative grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div data-reveal style={i(2)} aria-hidden className="mk-z1">
                <DashboardMock />
              </div>
              <div
                data-reveal
                style={i(4)}
                aria-hidden
                className="mk-3d mk-z2 relative mx-auto lg:-ml-16 lg:mt-16"
              >
                <PhoneLogger />
                <div
                  className="mk-z3 absolute -top-16 -right-6 hidden min-[900px]:block"
                  data-reveal
                  style={i(6)}
                >
                  <PrCard />
                </div>
                <div
                  className="mk-z3 absolute -right-14 -bottom-16 hidden min-[900px]:block"
                  data-reveal
                  style={i(7)}
                >
                  <FloatCard>
                    <p className="text-secondary">Set 3 · 82.5 kg × 5</p>
                    <SyncPill className="mt-1" />
                  </FloatCard>
                </div>
              </div>
            </div>
          </div>
          <p className="sr-only">
            A coach dashboard with 86% adherence this week, 142 workouts done, 27 of 31 check-ins in
            and $4,860 this month, next to a client logging bench press sets on a phone; the third
            set shows Saved on device, then Syncing, then Synced.
          </p>
        </DepthStage>
      </div>
    </section>
  );
}

/* ---------- 3. Switch strip ---------- */
function SwitchStrip() {
  const names = SWITCH_FROM.map((n) => (
    <a
      key={n}
      href="#compare"
      className="group inline-flex items-center gap-2 whitespace-nowrap text-xl font-semibold text-secondary transition-colors hover:text-ink"
    >
      {n}
      <span
        aria-hidden
        className="text-sm text-brand opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-1 group-hover:opacity-100"
      >
        → compare
      </span>
    </a>
  ));
  return (
    <section
      aria-label="Coaches switch from"
      className="relative border-y border-border bg-surface py-10"
    >
      <RulerTicks />
      <div className="mk-container">
        <p className="text-center text-[15px] text-secondary">
          Coaches switch to Repsy from the apps they&apos;ve outgrown. We help you move your clients
          and programs.
        </p>
      </div>
      <div className="mk-marquee-wrap mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
        <div className="mk-marquee px-6">
          {names}
          <span data-dup aria-hidden className="contents">
            {SWITCH_FROM.map((n) => (
              <span key={n} className="whitespace-nowrap text-xl font-semibold text-secondary">
                {n}
              </span>
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------- 3b. Product tour (video slot) ---------- */

/** The player shows only once the video and its captions are set in TOUR_VIDEO. */
const tourReady = Boolean(TOUR_VIDEO.src && TOUR_VIDEO.captions);

function Tour() {
  return (
    <section id="tour" aria-labelledby="tour-title" className="mk-section relative">
      <DotGrid tone="light" />
      <div className="mk-container">
        <Eyebrow>Product tour</Eyebrow>
        <H2 id="tour-title" className="mt-4 max-w-3xl">
          See a week of coaching in {TOUR_VIDEO.length}.
        </H2>
        <p data-reveal className="mt-4 max-w-2xl text-[17px] text-secondary">
          A client logs a workout, you review it, a check-in comes in and you act on it, all in
          Repsy.
        </p>
        <div
          data-reveal="tilt"
          className="relative mt-10 aspect-video overflow-hidden rounded-[20px] border border-border bg-surface shadow-e1"
        >
          {tourReady ? (
            <video
              controls
              playsInline
              preload="none"
              poster={TOUR_VIDEO.poster ?? undefined}
              className="size-full bg-ink object-cover"
            >
              <source src={TOUR_VIDEO.src!} type="video/mp4" />
              <track
                kind="captions"
                srcLang="en"
                label="English"
                src={TOUR_VIDEO.captions!}
                default
              />
            </video>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
              <LogGrid />
              <span
                aria-hidden
                className="relative flex size-16 items-center justify-center rounded-full border border-border bg-canvas text-secondary md:size-20"
              >
                <Play className="ml-1 size-7 md:size-8" />
              </span>
              <p className="relative text-[15px] font-semibold text-ink">Tour video coming soon</p>
              <p className="relative max-w-sm text-sm text-secondary">
                Until then, the walkthrough further down shows each step.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- 4. Six promises (bento) ---------- */
function PromiseVisual({ n }: { n: string }) {
  if (n === '01')
    return (
      <div className="mt-5 flex flex-wrap gap-2">
        <SyncPill />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-caption text-secondary">
          Set 4 · 80 kg × 6
        </span>
      </div>
    );
  if (n === '02')
    return (
      <ul className="mt-5 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2" data-cascade>
        {INCLUDED.slice(0, 6).map((f, k) => (
          <li key={f} style={i(k * 3)} className="flex items-center gap-2">
            <Check aria-hidden className="size-4 shrink-0 text-on-midnight" />
            {f}
          </li>
        ))}
      </ul>
    );
  if (n === '03')
    return (
      <pre
        className="mt-5 overflow-hidden rounded-md bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink"
        data-reveal
      >
        {`repsy-export-2026-11-06/
├── clients.csv
├── sessions.csv
├── set_logs.csv
├── checkins.csv
└── messages.csv`}
      </pre>
    );
  if (n === '04')
    return (
      <div className="mt-5 rounded-md border border-border bg-surface p-3 text-[13px]">
        <p className="font-semibold">Tom Becker · week 6 check-in</p>
        <p className="mt-1 text-secondary">4 of 4 workouts · sleep 3/5 · last reply 6 days ago</p>
      </div>
    );
  if (n === '05')
    return (
      <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-caption font-medium">
        <Sparkles aria-hidden className="size-3.5 text-brand" /> Drafted with AI · review before
        sending
      </span>
    );
  return (
    <div className="mt-5 rounded-md border border-border bg-surface p-3 text-[13px]">
      <p className="font-semibold">Plan lapsed on 1 Dec</p>
      <p className="mt-1 text-secondary">Read access for you and your clients until 1 Mar</p>
    </div>
  );
}

function Promises() {
  // 6-column bento: 4+2, 2+2+2, 3+3 (PRD §6 row 4). The second card is the brand-filled one.
  const spans = [
    'md:col-span-4',
    'md:col-span-2',
    'md:col-span-2',
    'md:col-span-2',
    'md:col-span-2',
    'md:col-span-6',
  ];
  return (
    <section id="promises" aria-labelledby="promises-title" className="mk-section">
      <RulerTicks />
      <AcidTabs
        spots={[
          { top: '8%', left: '88%' },
          { top: '46%', left: '2%', size: 10 },
        ]}
      />
      <div className="mk-container">
        <div className="relative max-w-3xl">
          <TrendLine className="-top-4" />
          <Eyebrow>Why coaches switch</Eyebrow>
          <H2 id="promises-title" className="mt-4">
            Six promises other coaching apps don&apos;t make.
          </H2>
        </div>
        <TiltList className="mt-12 grid gap-4 md:grid-cols-6">
          {PROMISES.map((p, k) => {
            const brand = k === 1;
            return (
              <li
                key={p.n}
                data-reveal="tilt"
                style={i(k)}
                className={cn(
                  'mk-lift mk-tilt relative overflow-hidden rounded-[16px] p-6 md:p-7',
                  spans[k],
                  brand
                    ? 'bg-midnight text-on-midnight shadow-e2'
                    : 'border border-border bg-surface shadow-e1',
                )}
              >
                <OutlineNumeral n={p.n} className="-top-6 -right-2 text-[140px] md:text-[200px]" />
                <p
                  className={cn(
                    'mk-eyebrow',
                    brand ? 'text-on-midnight-muted before:hidden' : 'text-brand before:hidden',
                  )}
                >
                  {p.n}
                </p>
                <h3 className="mk-display mt-3 text-[22px] font-semibold md:text-2xl">
                  {p.title}{' '}
                  {p.soon && (
                    <span className="ml-1 rounded-full bg-acid-soft px-2 py-0.5 align-middle font-sans text-[12px] font-semibold text-acid-ink">
                      Coming soon
                    </span>
                  )}
                </h3>
                <p
                  className={cn(
                    'mt-2 max-w-prose',
                    brand ? 'text-on-midnight-muted' : 'text-secondary',
                  )}
                >
                  {p.body}
                </p>
                <div aria-hidden>
                  <PromiseVisual n={p.n} />
                </div>
              </li>
            );
          })}
        </TiltList>
      </div>
    </section>
  );
}

/* ---------- 5. The loop ---------- */
function LoopPanel({ id }: { id: string }) {
  const box = 'rounded-lg border border-border bg-canvas p-4 text-sm';
  switch (id) {
    case 'invite':
      return (
        <div className={box}>
          <p className="font-semibold">Invite Priya Nair</p>
          <p className="mt-2 rounded-md border border-input-border bg-surface px-3 py-2 text-secondary">
            priya@example.com
          </p>
          <p className="mt-2 inline-flex rounded-md bg-brand px-3 py-1.5 font-semibold text-on-brand">
            Send invite
          </p>
        </div>
      );
    case 'program':
      return (
        <div className={cn(box, 'grid grid-cols-4 gap-1.5 text-[12px]')}>
          {['Mon', 'Tue', 'Thu', 'Sat'].map((d, k) => (
            <div key={d} className="rounded-md bg-surface p-2">
              <p className="font-semibold">{d}</p>
              <p className="text-secondary">{['Upper A', 'Lower A', 'Upper B', 'Lower B'][k]}</p>
            </div>
          ))}
        </div>
      );
    case 'train':
      return (
        <div className={cn(box, 'flex items-center justify-between')}>
          <span>Bench press · set 3 · 82.5 kg × 5</span>
          <SyncPill />
        </div>
      );
    case 'review':
      return (
        <ul className={cn(box, 'flex flex-col gap-2')}>
          <li className="flex justify-between">
            <span>Priya Nair</span>
            <span className="text-danger">2 missed in 7 days</span>
          </li>
          <li className="flex justify-between">
            <span>Ana Ruiz</span>
            <span className="text-warning">Unfinished workout</span>
          </li>
        </ul>
      );
    case 'checkin':
      return (
        <div className={box}>
          <p className="font-semibold">How was your sleep this week?</p>
          <div className="mt-2 flex gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <span
                key={v}
                className={cn(
                  'flex size-9 items-center justify-center rounded-md font-semibold',
                  v === 4 ? 'bg-brand text-on-brand' : 'bg-surface',
                )}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      );
    default:
      return (
        <div className={box}>
          <p className="text-secondary">Reply to Tom</p>
          <p className="mt-1">Great week. Let&apos;s add 2.5 kg to bench on Thursday.</p>
        </div>
      );
  }
}

function Loop() {
  return (
    <section id="loop" aria-labelledby="loop-title" className="mk-section bg-surface">
      <RulerTicks />
      <div className="mk-container relative">
        <OutlineNumeral n="06" className="-top-16 right-0 hidden text-[200px] md:block" />
        <Eyebrow>How it works</Eyebrow>
        <H2 id="loop-title" className="mt-4 max-w-3xl">
          Your whole coaching week, in one loop.
        </H2>
        <div className="mt-12">
          <LoopStepper
            panels={LOOP.map((s) => (
              <LoopPanel key={s.id} id={s.id} />
            ))}
          />
        </div>
      </div>
    </section>
  );
}

/* ---------- 6. Client experience (ink section) ---------- */
function ClientExperience() {
  const points = [
    'Log a set in two taps, with last time’s numbers in the row',
    'Rest timer between sets',
    'Works offline and syncs when the signal is back',
    'Add to the home screen; no app store needed',
    'Your logo and colours, not ours',
  ];
  return (
    <section aria-labelledby="client-title" className="mk-section bg-ink text-canvas">
      <DotGrid tone="onInk" />
      <AcidTabs
        spots={[
          { top: '12%', left: '94%' },
          { top: '78%', left: '48%', size: 10 },
        ]}
      />
      <div className="mk-container grid items-center gap-12 lg:grid-cols-2">
        <div>
          <p className="mk-eyebrow text-canvas/70">For your clients</p>
          <H2 id="client-title" className="mt-4">
            An app your clients actually open.
          </H2>
          <ul className="mt-8 flex flex-col gap-3 text-[17px] text-canvas/85">
            {points.map((p, k) => (
              <li key={p} data-reveal style={i(k)} className="flex gap-3">
                <Check aria-hidden className="mt-1 size-5 shrink-0 text-acid" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden className="flex justify-center gap-4">
          <div data-reveal>
            <PhoneLogger />
          </div>
          <div data-reveal style={i(2)} className="mt-12 hidden sm:block">
            <div className="w-[230px] rounded-[2.2rem] border border-border bg-surface p-2.5 text-ink">
              <div className="rounded-[1.7rem] bg-canvas p-3">
                <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-border" />
                <p className="text-caption font-semibold">This week</p>
                <p className="mk-display mt-1 text-3xl font-bold">
                  <Num value={3} />
                  <span className="text-lg text-secondary"> of 4</span>
                </p>
                <div className="mt-2 flex gap-1.5">
                  {[1, 1, 1, 0, 0, 0, 0].map((d, k) => (
                    <span
                      key={k}
                      className={cn(
                        'size-5 rounded-full',
                        d ? 'bg-success' : 'border border-input-border',
                        k === 3 && 'ring-2 ring-on-acid ring-offset-2 ring-offset-acid',
                      )}
                    />
                  ))}
                </div>
                <p className="mt-4 text-caption font-semibold">Bench press, best set</p>
                <svg viewBox="0 0 200 70" className="mt-1 w-full" data-draw fill="none">
                  <polyline
                    pathLength={1}
                    points="0,60 40,52 80,48 120,36 160,30 200,14"
                    stroke="var(--k-brand)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 7. Progress ---------- */
const E1RM = [100, 102.5, 104, 103, 107, 109, 108.5, 112, 114, 116, 119, 124];
function Progress() {
  const w = 560;
  const h = 200;
  const min = 96;
  const max = 128;
  const pts = E1RM.map(
    (v, k) => [(k / (E1RM.length - 1)) * w, h - ((v - min) / (max - min)) * h] as const,
  );
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts.at(-1)!;
  const heat = Array.from({ length: 12 * 7 }, (_, k) => ((k * 37) % 11) / 10);
  return (
    <section aria-labelledby="progress-title" className="mk-section">
      <RulerTicks />
      <PlateRings size={480} className="top-24 -left-56 hidden md:block" />
      <div className="mk-container grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="relative">
          <TrendLine className="-top-6" />
          <Eyebrow>Progress</Eyebrow>
          <H2 id="progress-title" className="mt-4">
            Show clients they&apos;re getting stronger.
          </H2>
          <p data-reveal className="mt-5 text-[17px] text-secondary">
            Estimated 1RM from every logged set (Epley), personal records marked as they happen, and
            12 weeks of consistency in one glance.
          </p>
          <p data-reveal className="mk-display mt-8 text-6xl font-bold">
            <Num value={124} from={100} suffix=" kg" />
          </p>
          <p className="text-secondary">Bench press e1RM, up from 100 kg in 12 weeks</p>
        </div>
        <div
          aria-hidden
          data-reveal
          className="rounded-[24px] border border-border bg-surface p-5 shadow-e1 md:p-6"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold">Bench press · estimated 1RM</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-acid-soft px-2.5 py-1 text-caption font-semibold text-acid-ink">
              New PR · 124 kg
            </span>
          </div>
          <svg viewBox={`-8 -12 ${w + 16} ${h + 24}`} className="mt-4 w-full" data-draw fill="none">
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <line
                key={g}
                x1={0}
                x2={w}
                y1={g * h}
                y2={g * h}
                stroke="var(--k-border)"
                strokeWidth={1}
              />
            ))}
            <polyline
              pathLength={1}
              points={line}
              stroke="var(--k-brand)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={last[0]}
              cy={last[1]}
              r={7}
              fill="var(--k-acid)"
              stroke="var(--k-on-acid)"
              strokeWidth={1.5}
            />
          </svg>
          <p className="mt-5 text-caption font-semibold">Consistency, last 12 weeks</p>
          <div className="mt-2 grid grid-flow-col grid-rows-7 gap-1" data-cascade>
            {heat.map((v, k) => (
              <span
                key={k}
                style={{ ...i((k % 7) + Math.floor(k / 7)), opacity: undefined }}
                className={cn(
                  'aspect-square rounded-[3px]',
                  v > 0.7
                    ? 'bg-brand'
                    : v > 0.4
                      ? 'bg-brand/60'
                      : v > 0.15
                        ? 'bg-brand-soft'
                        : 'bg-surface-2',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- 8. Run the business ---------- */
function Business() {
  const cards = [
    {
      icon: CalendarClock,
      title: 'Sessions and packs',
      body: 'Clients book your open slots; packs count down as sessions happen.',
      visual: (
        <div className="grid grid-cols-3 gap-1.5 text-[12px]">
          {['9:00', '10:00', '11:00', '14:00', '15:00', '16:00'].map((t, k) => (
            <span
              key={t}
              className={cn(
                'rounded-md px-2 py-1.5 text-center',
                k === 3 ? 'bg-brand font-semibold text-on-brand' : 'bg-surface-2 text-secondary',
              )}
            >
              {k === 3 ? 'Priya · PT' : t}
            </span>
          ))}
        </div>
      ),
    },
    {
      icon: Workflow,
      title: 'Automations',
      body: 'Welcome messages, check-in nudges and program hand-offs run on their own.',
      visual: (
        <ol className="flex items-center gap-2 text-[12px]">
          {['Invite accepted', 'Wait 1 day', 'Send welcome'].map((s, k) => (
            <li key={s} className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-surface px-2 py-1.5">{s}</span>
              {k < 2 && <span className="h-px w-4 bg-input-border" />}
            </li>
          ))}
        </ol>
      ),
    },
    {
      icon: CreditCard,
      title: 'Client payments',
      body: 'Packages and subscriptions with a checkout page. Record payments you take elsewhere today.',
      soon: true,
      visual: (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-[13px]">
          <span>12-week program</span>
          <span className="tabular font-semibold">$360.00</span>
        </div>
      ),
    },
  ];
  return (
    <section aria-labelledby="business-title" className="mk-section bg-surface">
      <RulerTicks />
      <div className="mk-container">
        <Eyebrow>Run the business</Eyebrow>
        <H2 id="business-title" className="mt-4 max-w-3xl">
          Book sessions, automate the follow-ups, see the numbers.
        </H2>
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {cards.map((c, k) => (
            <li
              key={c.title}
              data-reveal
              style={i(k)}
              className="mk-lift rounded-[16px] border border-border bg-canvas p-6 shadow-e1"
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
                <c.icon aria-hidden className="size-5" strokeWidth={1.75} />
              </span>
              <h3 className="mk-display mt-4 text-[22px] font-semibold">
                {c.title}{' '}
                {c.soon && (
                  <span className="ml-1 rounded-full bg-acid-soft px-2 py-0.5 align-middle font-sans text-[12px] font-semibold text-acid-ink">
                    Coming soon
                  </span>
                )}
              </h3>
              <p className="mt-2 text-secondary">{c.body}</p>
              <div aria-hidden className="mt-5">
                {c.visual}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- 9. Compare ---------- */
function Compare() {
  const checked = COMPETITORS.map((c) => c.lastVerified).sort()[0];
  return (
    <section id="compare" aria-labelledby="compare-title" className="mk-section">
      <RulerTicks />
      <div className="mk-container">
        <Eyebrow>Compare</Eyebrow>
        <H2 id="compare-title" className="mt-4 max-w-3xl">
          The price on the page is the price you pay.
        </H2>
        <p data-reveal className="mt-4 max-w-2xl text-[17px] text-secondary">
          What each feature costs on top of the base plan.
        </p>
        <div
          data-reveal
          role="region"
          aria-labelledby="compare-title"
          tabIndex={0}
          className="mt-10 overflow-x-auto rounded-[16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand border border-border bg-surface shadow-e1"
        >
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Repsy compared with other coaching apps, feature by feature
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="sticky left-0 z-10 bg-surface p-4 font-semibold">
                  Feature
                </th>
                <th scope="col" className="bg-brand-soft p-4 font-semibold text-brand-ink">
                  Repsy
                </th>
                {COMPETITORS.map((c) => (
                  <th key={c.slug} scope="col" className="p-4 font-semibold">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((r, k) => (
                <tr
                  key={r.id}
                  data-reveal
                  style={i(k)}
                  className="border-b border-border last:border-0"
                >
                  <th scope="row" className="sticky left-0 z-10 bg-surface p-4 font-medium">
                    {r.label}
                  </th>
                  <td className="bg-brand-soft p-4 font-semibold text-brand-ink">
                    <span className="inline-flex items-center gap-1.5">
                      {REPSY_CELLS[r.id] === 'Included' ? (
                        <Check aria-hidden className="size-4" />
                      ) : REPSY_CELLS[r.id] === 'Coming soon' ? (
                        <Minus aria-hidden className="size-4" />
                      ) : null}
                      {REPSY_CELLS[r.id]}
                    </span>
                  </td>
                  {COMPETITORS.map((c) => (
                    <td key={c.slug} className="p-4 text-secondary">
                      {c.cells[r.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] text-secondary">
          Competitor figures are from third-party reviews, checked on {checked}, and not yet
          confirmed with each vendor. Sources:{' '}
          {COMPETITORS.flatMap((c) => c.sources).map((s, k, all) => (
            <span key={s.url}>
              <a
                href={s.url}
                className="underline underline-offset-2 hover:text-ink"
                rel="noopener noreferrer"
                target="_blank"
              >
                {s.label}
              </a>
              {k < all.length - 1 ? ' · ' : '.'}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

/* ---------- 10. Pricing ---------- */
function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mk-section bg-surface">
      <RulerTicks />
      <DotGrid />
      <div className="mk-container">
        <div className="relative mx-auto max-w-3xl text-center">
          <TrendLine className="-top-4" />
          <Eyebrow className="justify-center">Pricing</Eyebrow>
          <H2 id="pricing-title" className="mt-4">
            Plans differ by client count. Nothing else.
          </H2>
        </div>
        <div className="mt-10">
          <PricingPlans />
        </div>
        <div data-reveal className="mt-8 rounded-[16px] border border-border bg-canvas p-6">
          <p className="font-semibold">Every plan includes</p>
          <ul
            className="mt-3 grid gap-2 text-sm text-secondary sm:grid-cols-2 lg:grid-cols-5"
            data-cascade
          >
            {INCLUDED.map((f, k) => (
              <li key={f} style={i(k * 2)} className="flex items-center gap-2">
                <Check aria-hidden className="size-4 shrink-0 text-success" />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-secondary">
            Over your plan&apos;s limit: $1 per extra active client a month. Paused and archived
            clients don&apos;t count.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- 11. Trust ---------- */
function Trust() {
  const icons = [Lock, Accessibility, FileDown, Activity];
  return (
    <section aria-labelledby="trust-title" className="mk-section">
      <RulerTicks />
      <div className="mk-container">
        <Eyebrow>Trust</Eyebrow>
        <H2 id="trust-title" className="mt-4 max-w-3xl">
          Built like your clients&apos; data matters. Because it does.
        </H2>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t, k) => {
            const Icon = icons[k]!;
            return (
              <li
                key={t.title}
                data-reveal
                style={i(k)}
                className="mk-lift rounded-[16px] border border-border bg-surface p-6 shadow-e1"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
                    <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="mk-eyebrow text-secondary before:hidden">0{k + 1}</span>
                </div>
                <h3 className="mk-display mt-4 text-xl font-semibold">{t.title}</h3>
                <p className="mt-2 text-secondary">{t.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------- 12. FAQ, final CTA, footer ---------- */
function Faq() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
  return (
    <section id="faq" aria-labelledby="faq-title" className="mk-section bg-surface">
      <RulerTicks />
      <div className="mk-container grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <Eyebrow>Questions</Eyebrow>
          <H2 id="faq-title" className="mt-4">
            Before you switch.
          </H2>
        </div>
        <div className="divide-y divide-border rounded-[16px] border border-border bg-canvas">
          {FAQ.map((f) => (
            <details key={f.q} className="mk-faq group px-5">
              <summary className="flex min-h-14 items-center justify-between gap-4 py-4 text-[17px] font-semibold">
                {f.q}
                <Plus aria-hidden className="mk-faq-icon size-5 shrink-0 text-brand" />
              </summary>
              <p className="pb-5 text-secondary">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="mk-section !py-0">
      <div className="mk-container">
        <div className="relative overflow-hidden rounded-[32px] bg-midnight px-6 py-16 text-center text-on-midnight md:py-24">
          <DotGrid tone="light" />
          <div
            aria-hidden
            className="mk-bg [background-image:linear-gradient(color-mix(in_srgb,var(--k-on-midnight)_8%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--k-on-midnight)_8%,transparent)_1px,transparent_1px)] [background-size:40px_40px]"
          />
          <AcidTabs
            spots={[
              { top: '18%', left: '10%' },
              { top: '70%', left: '86%', size: 14 },
              { top: '30%', left: '90%', size: 10 },
            ]}
          />
          <h2
            id="cta-title"
            data-reveal
            className="mk-display mx-auto max-w-3xl text-[34px] font-bold md:text-[56px]"
          >
            Bring your clients. We&apos;ll help with the rest.
          </h2>
          <div data-reveal style={i(1)} className="mt-8 flex flex-wrap justify-center gap-3">
            <PrimaryCta tone="acid">Start free with 3 clients</PrimaryCta>
            <SecondaryCta href="mailto:hello@repsy.fit?subject=Help%20moving%20to%20Repsy" onDark>
              Ask for help moving
            </SecondaryCta>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    {
      h: 'Product',
      links: [
        ['Features', '#promises'],
        ['How it works', '#loop'],
        ['Pricing', '#pricing'],
        ['Compare', '#compare'],
      ],
    },
    {
      h: 'Account',
      links: [
        ['Start free', '/signup'],
        ['Log in', '/login'],
        ['Plan and billing', '/plan'],
      ],
    },
    {
      h: 'Company',
      links: [
        ['Changelog', '/changelog'],
        ['Status', '/status'],
        ['Contact', 'mailto:hello@repsy.fit'],
        ['Terms', '/terms'],
        ['Privacy', '/privacy'],
      ],
    },
    {
      h: 'Switch',
      links: [
        ['From a spreadsheet', '#faq'],
        ['From another app', '#faq'],
        ['FAQ', '#faq'],
      ],
    },
  ];
  return (
    <footer className="relative mt-24 border-t border-border bg-canvas">
      <div className="mk-container grid gap-10 py-14 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <div>
          <Link href="/" className="flex items-center gap-2" aria-label="Repsy home">
            <RepsyMark className="size-8" />
            <span className="mk-display text-xl font-bold">Repsy</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm text-secondary">
            Coaching software that never drops the ball.
          </p>
        </div>
        {cols.map((c) => (
          <nav key={c.h} aria-label={c.h}>
            <p className="text-sm font-semibold">{c.h}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-secondary">
              {c.links.map(([label, href]) => (
                <li key={label}>
                  <a
                    href={href}
                    className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-[240ms] hover:bg-[length:100%_1px] hover:text-ink"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <Wordmark />
      <p className="mk-container flex flex-wrap gap-4 pb-8 text-[13px] text-secondary">
        <span>© Repsy</span>
        <CookieSettingsLink className="underline-offset-4 hover:text-ink hover:underline" />
      </p>
    </footer>
  );
}

/** The marketing home page (landing PRD rev 2, §6). Signed-out visitors to `/` see this. */
export function Landing() {
  return (
    <div className={cn('mk', display.variable)}>
      <script dangerouslySetInnerHTML={{ __html: motionBoot }} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <Grain />
      <MarketingAnalytics />
      <MarketingNav />
      <main id="main">
        <Hero />
        <SwitchStrip />
        <Tour />
        <Promises />
        <Loop />
        <ClientExperience />
        <Progress />
        <Business />
        <Compare />
        <Pricing />
        <Trust />
        <Faq />
        <div className="py-16">
          <FinalCta />
        </div>
      </main>
      <Footer />
      <MotionController />
      <MotionPauseToggle />
    </div>
  );
}
