import { cn } from '@/lib/utils';

/** A tiny trend line (server SVG). Decorative: the tile prints the value; nulls are gaps. */
export function Sparkline({
  values,
  className,
  tone = 'ember',
}: {
  values: Array<number | null>;
  className?: string;
  tone?: 'ember' | 'cyan';
}) {
  const W = 80;
  const H = 32;
  const nums = values.filter((v): v is number => v !== null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const x = (i: number) => (values.length < 2 ? W / 2 : (i / (values.length - 1)) * (W - 4) + 2);
  const y = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  let d = '';
  values.forEach((v, i) => {
    if (v === null) return;
    const prev = values[i - 1];
    d += `${i === 0 || prev === null || prev === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const lastIdx =
    values
      .map((v, i) => (v === null ? -1 : i))
      .filter((i) => i >= 0)
      .at(-1) ?? 0;
  const stroke = tone === 'cyan' ? 'var(--k-cyan)' : 'var(--k-ember)';
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className={cn('overflow-visible', className)}>
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {nums.length > 0 && <circle cx={x(lastIdx)} cy={y(values[lastIdx]!)} r="2.5" fill={stroke} />}
    </svg>
  );
}
