import type { ReactNode } from 'react';
import { CalendarCheck, LineChart, MessageSquare } from 'lucide-react';
import { RepsyLogo } from '@/components/brand/Logo';
import { ProgressRing } from '@/components/charts/ProgressRing';

export const inputClass =
  'block w-full min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink placeholder:text-secondary hover:border-ink/50 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-invalid:border-danger';
export const buttonClass =
  'min-h-11 w-full rounded-control bg-accent-fill px-4 text-base font-semibold text-on-accent shadow-e1 transition-colors hover:bg-accent-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const secondaryButtonClass =
  'min-h-11 w-full rounded-control border border-input-border bg-surface px-4 text-base font-medium text-ink transition-colors hover:bg-surface-2';
export const linkClass = 'font-medium text-accent underline-offset-2 hover:underline';

const POINTS = [
  { icon: CalendarCheck, text: 'Programs, check-ins and habits in one place' },
  { icon: LineChart, text: 'See who is on track at a glance' },
  { icon: MessageSquare, text: 'Message clients without a second app' },
];

/**
 * Account pages (sign in, sign up, reset, verify, invite): a midnight brand panel with a small product preview from
 * 1024px up, and the form card. The preview is decorative.
 */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section
        aria-label="About Repsy"
        className="relative hidden overflow-hidden bg-midnight p-12 text-on-midnight lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-ember/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full bg-cyan/10 blur-3xl"
        />
        <RepsyLogo size="lg" tone="light" className="relative" />
        <div className="relative max-w-md">
          <p className="text-display font-semibold tracking-tight">
            Coaching that keeps every client moving.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md bg-midnight-2 text-ember">
                  <p.icon aria-hidden className="size-5" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
          <div
            aria-hidden
            className="mt-10 flex items-center gap-4 rounded-xl bg-midnight-2 p-4 ring-1 ring-white/10"
          >
            <ProgressRing value={86} size={64} stroke={7} onDark />
            <div className="text-sm">
              <p className="font-semibold">Adherence this week</p>
              <p className="text-on-midnight-muted">18 of 21 due workouts done</p>
            </div>
          </div>
        </div>
        <p className="relative text-sm text-on-midnight-muted">repsy.fit</p>
      </section>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <RepsyLogo className="mb-8 lg:hidden" />
          <div className="rounded-xl border border-border bg-surface p-6 text-ink shadow-e1 sm:p-8">
            <h1 className="mb-6 text-h1 font-semibold">{title}</h1>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  defaultValue?: string;
  minLength?: number;
  inputMode?: 'numeric' | 'text';
  required?: boolean;
}) {
  const { label, name, error, hint, required = true, ...rest } = props;
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  return (
    <div className="mb-4">
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-sm text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormMessage({ children, tone }: { children: ReactNode; tone: 'error' | 'info' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-4 text-sm ${tone === 'error' ? 'text-danger' : 'text-secondary'}`}
    >
      {children}
    </p>
  );
}
