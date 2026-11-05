import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/charts/CountUp';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/utils';

/** Counts a plain number or "88%" up on first show; anything else renders as given. */
function animated(value: ReactNode): ReactNode {
  if (typeof value === 'number') return <CountUp value={value} />;
  if (typeof value === 'string') {
    const m = /^(\d+(?:\.\d+)?)(%| h| min)?$/.exec(value);
    if (m) {
      const n = Number(m[1]);
      return <CountUp value={n} decimals={m[1]!.includes('.') ? 1 : 0} suffix={m[2] ?? ''} />;
    }
  }
  return value;
}

export interface Delta {
  /** Signed change vs the previous period, in the tile's unit. */
  value: number;
  /** "vs last week". */
  label: string;
  /** Whether up is good (adherence) or bad (missed workouts). */
  goodWhen?: 'up' | 'down';
  /** Formats the absolute change, e.g. (v) => `${v} pts`. */
  format?: (v: number) => string;
}

/**
 * A KPI tile: micro label, big tabular value, optional delta (arrow + words, never colour alone), optional
 * sparkline and link. The delta and sparkline restate numbers; the value is always printed.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  spark,
  href,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: Delta | null;
  spark?: Array<number | null>;
  href?: string;
  tone?: 'default' | 'hero';
  className?: string;
}) {
  const hero = tone === 'hero';
  const body = (
    <>
      <p className={cn('label-micro', hero ? 'text-on-midnight-muted' : 'text-secondary')}>
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="tabular text-display font-semibold tracking-tight">{animated(value)}</p>
        {spark && spark.filter((v) => v !== null).length > 1 && (
          <Sparkline values={spark} className="mb-1 h-8 w-20" tone={hero ? 'cyan' : 'ember'} />
        )}
      </div>
      {delta && <DeltaLine delta={delta} hero={hero} />}
      {hint && (
        <p className={cn('mt-1 text-caption', hero ? 'text-on-midnight-muted' : 'text-secondary')}>
          {hint}
        </p>
      )}
    </>
  );
  const box = cn(
    'block rounded-card p-4 sm:p-5',
    hero ? 'bg-midnight text-on-midnight shadow-e2' : 'border border-border bg-surface shadow-e1',
    href && 'transition-[border-color,box-shadow] hover:shadow-e2',
    href && !hero && 'hover:border-input-border',
    className,
  );
  return href ? (
    <Link href={href} className={box}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function DeltaLine({ delta, hero }: { delta: Delta; hero: boolean }) {
  const { value, label, goodWhen = 'up', format = (v: number) => String(v) } = delta;
  const flat = value === 0;
  const up = value > 0;
  const good = flat ? null : (up && goodWhen === 'up') || (!up && goodWhen === 'down');
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const colour = hero
    ? 'text-on-midnight'
    : good === null
      ? 'text-secondary'
      : good
        ? 'text-success'
        : 'text-danger';
  return (
    <p className={cn('mt-1 flex items-center gap-1 text-caption font-medium', colour)}>
      <Icon aria-hidden className="size-3.5" />
      <span>
        {flat ? 'No change' : `${up ? 'Up' : 'Down'} ${format(Math.abs(value))}`} {label}
      </span>
    </p>
  );
}
