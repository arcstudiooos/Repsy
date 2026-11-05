import type { CSSProperties, ReactNode } from 'react';
import { Check, CloudOff, Loader2, Timer, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Product visuals rebuilt in code with realistic sample data (landing PRD §8, §11). Decorative copies of real
 * screens: each frame is aria-hidden and its meaning is in the surrounding text.
 */

const i = (n: number) => ({ '--mk-i': n }) as CSSProperties;

/** A count-up number: the final value is the static text; the controller animates it once. */
export function Num({
  value,
  prefix = '',
  suffix = '',
  from,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  from?: number;
}) {
  return (
    <span
      className="tabular"
      data-count={value}
      data-prefix={prefix}
      data-suffix={suffix}
      data-from={from}
    >
      {prefix}
      {value.toLocaleString('en-US')}
      {suffix}
    </span>
  );
}

export function SyncPill({ className }: { className?: string }) {
  return (
    <span className={cn('mk-sync inline-grid rounded-full text-caption font-medium', className)}>
      <span
        data-state="saved"
        className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-warning-ink"
      >
        <CloudOff aria-hidden className="size-3.5" /> Saved on device
      </span>
      <span
        data-state="syncing"
        className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2.5 py-1 text-info-ink"
      >
        <Loader2 aria-hidden className="mk-spinner size-3.5" /> Syncing
      </span>
      <span
        data-state="synced"
        className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-success-ink"
      >
        <Check aria-hidden className="size-3.5" /> Synced
      </span>
    </span>
  );
}

function Tile({
  label,
  children,
  sub,
  hero,
}: {
  label: string;
  children: ReactNode;
  sub: string;
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3',
        hero ? 'bg-midnight text-on-midnight' : 'border border-border bg-surface',
      )}
    >
      <p className={cn('label-micro', hero ? 'text-on-midnight-muted' : 'text-secondary')}>
        {label}
      </p>
      <p className="mk-display mt-1 text-[26px] font-semibold">{children}</p>
      <p className={cn('text-[11px]', hero ? 'text-on-midnight-muted' : 'text-secondary')}>{sub}</p>
    </div>
  );
}

const WEEK = [
  { d: 'Mon', done: 9, missed: 1 },
  { d: 'Tue', done: 7, missed: 0 },
  { d: 'Wed', done: 11, missed: 1 },
  { d: 'Thu', done: 8, missed: 2, today: true },
  { d: 'Fri', done: 0, missed: 0 },
  { d: 'Sat', done: 0, missed: 0 },
  { d: 'Sun', done: 0, missed: 0 },
];

/** Coach dashboard: 4 KPI tiles + this-week bars + needs-attention rows. */
export function DashboardMock() {
  return (
    <div className="rounded-xl border border-border bg-canvas p-4 shadow-[0_24px_60px_color-mix(in_srgb,var(--k-brand)_16%,transparent)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="label-micro text-brand">Thursday 6 November</p>
          <p className="mk-display text-[22px] font-semibold">Good morning, Maya</p>
        </div>
        <span className="rounded-md bg-brand px-3 py-1.5 text-caption font-semibold text-on-brand">
          Add client
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Adherence" sub="35 of 41 workouts" hero>
          <Num value={86} suffix="%" />
        </Tile>
        <Tile label="Workouts done" sub="This week">
          <Num value={142} />
        </Tile>
        <Tile label="Check-ins in" sub="On time this week">
          <Num value={27} />
          <span className="text-secondary">/31</span>
        </Tile>
        <Tile label="Revenue" sub="Month to date">
          <Num value={4860} prefix="$" />
        </Tile>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-caption font-semibold">This week</p>
          <div className="mt-2 flex h-28 items-end gap-2" data-grow>
            {WEEK.map((w, n) => {
              const total = w.done + w.missed;
              return (
                <div
                  key={w.d}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  style={i(n)}
                >
                  <div
                    className={cn(
                      'flex w-full max-w-7 flex-col-reverse overflow-hidden rounded-[5px]',
                      total === 0 && 'h-1 bg-surface-2',
                      w.today && 'ring-2 ring-on-acid ring-offset-2 ring-offset-acid',
                    )}
                    style={total ? { height: `${(total / 12) * 82}%` } : undefined}
                  >
                    {w.done > 0 && <span className="bg-success" style={{ flexGrow: w.done }} />}
                    {w.missed > 0 && <span className="bg-danger" style={{ flexGrow: w.missed }} />}
                  </div>
                  <span
                    className={cn(
                      'text-[10px]',
                      w.today ? 'font-semibold text-ink' : 'text-secondary',
                    )}
                  >
                    {w.d}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-caption font-semibold">Needs attention</p>
          <ul className="mt-2 flex flex-col gap-2 text-[12px]">
            {[
              ['Priya Nair', '2 missed workouts in 7 days', 'danger'],
              ['Tom Becker', 'Check-in waiting 26h', 'warning'],
              ['Ana Ruiz', 'Program ends Sunday', 'info'],
            ].map(([who, what, tone]) => (
              <li key={who} className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    tone === 'danger' && 'bg-danger',
                    tone === 'warning' && 'bg-warning',
                    tone === 'info' && 'bg-info',
                  )}
                />
                <span className="font-medium">{who}</span>
                <span className="truncate text-secondary">{what}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const SETS = [
  { n: 1, prev: '80 × 6', kg: 82.5, reps: 6, done: true },
  { n: 2, prev: '80 × 6', kg: 82.5, reps: 6, done: true },
  { n: 3, prev: '80 × 5', kg: 82.5, reps: 5, done: true },
  { n: 4, prev: '77.5 × 6', kg: 80, reps: '', done: false },
];

/** Client logger on a phone: set table, sync pill, rest timer. */
export function PhoneLogger({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-[260px] rounded-[2.2rem] border border-border bg-surface p-2.5 shadow-[0_24px_60px_color-mix(in_srgb,var(--k-brand)_18%,transparent)]',
        className,
      )}
    >
      <div className="rounded-[1.7rem] bg-canvas p-3">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <p className="text-caption font-semibold">Upper A</p>
          <SyncPill />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[62%] rounded-full bg-brand" />
        </div>
        <p className="mt-3 text-[13px] font-semibold">Barbell bench press</p>
        <table className="mt-1 w-full text-[11px]">
          <thead className="text-secondary">
            <tr>
              <th className="py-1 text-left font-medium">Set</th>
              <th className="text-left font-medium">Prev</th>
              <th className="text-right font-medium">kg</th>
              <th className="text-right font-medium">Reps</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="tabular">
            {SETS.map((s) => (
              <tr key={s.n} className={cn(s.done && 'text-ink')}>
                <td className="py-1">{s.n}</td>
                <td className="text-secondary">{s.prev}</td>
                <td className="text-right">{s.kg}</td>
                <td className="text-right">{s.reps || '–'}</td>
                <td className="text-right">
                  <span
                    className={cn(
                      'ml-auto inline-flex size-4 items-center justify-center rounded-[4px] border',
                      s.done ? 'border-success bg-success text-on-brand' : 'border-input-border',
                    )}
                  >
                    {s.done && <Check className="size-3" />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface p-2">
          <span className="flex items-center gap-1.5 text-[11px] text-secondary">
            <Timer aria-hidden className="size-3.5" /> Rest
          </span>
          <span className="tabular text-[13px] font-semibold">1:30</span>
        </div>
      </div>
    </div>
  );
}

export function FloatCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mk-float-card rounded-lg border border-border bg-surface px-3 py-2 text-caption shadow-e2',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PrCard() {
  return (
    <FloatCard>
      <p className="flex items-center gap-1.5 font-semibold text-acid-ink">
        <span className="flex size-5 items-center justify-center rounded-[5px] bg-acid text-on-acid ring-1 ring-on-acid">
          <Trophy aria-hidden className="size-3" />
        </span>
        New PR
      </p>
      <p className="mt-0.5 text-ink">
        Deadlift <span className="tabular font-semibold">152.5 kg</span>
      </p>
    </FloatCard>
  );
}
