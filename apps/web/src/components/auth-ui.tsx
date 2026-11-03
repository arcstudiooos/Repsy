import type { ReactNode } from 'react';
import { CalendarCheck, LineChart, MessageSquare } from 'lucide-react';
import { RepsyLogo } from '@/components/brand/Logo';

export const inputClass =
  'block w-full min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink shadow-xs transition-[border-color,box-shadow] duration-[var(--k-motion-fast)] placeholder:text-secondary hover:border-ink/50 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--k-accent-soft)] focus-visible:outline-none aria-invalid:border-danger';
export const buttonClass =
  'min-h-11 w-full rounded-control bg-accent px-4 text-base font-semibold text-white shadow-sm transition-colors duration-[var(--k-motion-fast)] hover:bg-accent-hover active:translate-y-px disabled:opacity-60';
export const secondaryButtonClass =
  'min-h-11 w-full rounded-control border border-input-border bg-surface px-4 text-base font-medium text-ink shadow-sm transition-colors duration-[var(--k-motion-fast)] hover:bg-surface-muted';
export const linkClass =
  'font-medium text-accent underline-offset-2 hover:text-accent-hover hover:underline';

const POINTS = [
  { icon: CalendarCheck, text: 'Programs, check-ins and habits in one place' },
  { icon: LineChart, text: 'See who is on track at a glance' },
  { icon: MessageSquare, text: 'Message clients without a second app' },
];

/**
 * Sign-in, sign-up and the other account pages: the brand panel on the left from 1024px up, the form on the right.
 */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section
        aria-label="About Repsy.fit"
        className="relative hidden overflow-hidden bg-[image:var(--k-gradient-brand)] p-12 text-white lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/[0.07]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-[#F97316]/20 blur-3xl"
        />
        <RepsyLogo size="lg" tone="light" className="relative" />
        <div className="relative max-w-md">
          <p className="text-4xl leading-tight font-bold tracking-tight">
            Coaching that keeps every client moving.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-base text-white">
                <span className="flex size-9 items-center justify-center rounded-control bg-white/15">
                  <p.icon aria-hidden className="size-5" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white">repsy.fit</p>
      </section>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <RepsyLogo size="md" className="mb-8 lg:hidden" />
          <div className="rounded-card border border-border bg-surface p-6 text-ink shadow-card sm:p-8">
            <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
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
