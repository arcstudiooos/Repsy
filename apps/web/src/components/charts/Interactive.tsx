'use client';

/**
 * Interactive charts (D-014): Recharts 3, wrapped so pages never import it and colours come only from tokens.
 * Each is used inside a ChartFrame, which carries the title, summary and table view; these add hover tooltips.
 */
import {
  Area,
  AreaChart as RArea,
  Bar,
  BarChart as RBar,
  CartesianGrid,
  Line,
  LineChart as RLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from 'recharts';
import { AXIS, GRID, SERIES } from './palette';
import { useSyncExternalStore } from 'react';

export interface Series {
  key: string;
  label: string;
  /** Defaults to the palette in order. */
  color?: string;
  dashed?: boolean;
}

type Datum = Record<string, string | number | null>;

const axisProps = {
  stroke: AXIS,
  tick: { fill: 'var(--k-secondary)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

function TooltipBox({
  active,
  label,
  payload,
  unit,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-border bg-surface px-3 py-2 text-caption text-ink shadow-e2">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="tabular font-medium">{p.value ?? '–'}</span>
          {unit && p.value !== null && p.value !== undefined ? ` ${unit}` : ''}
        </p>
      ))}
    </div>
  );
}

/** Recharts draws in once unless the viewer asked for reduced motion. */
function useAnimate(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia('(prefers-reduced-motion: reduce)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

const colorOf = (s: Series, i: number) => s.color ?? SERIES[i % SERIES.length]!;

export function LineChart({
  data,
  x,
  series,
  unit,
  height = 220,
  markers,
}: {
  data: Datum[];
  x: string;
  series: Series[];
  unit?: string;
  height?: number;
  /** Points to mark (personal records): x value + series key. */
  markers?: Array<{ x: string | number; key: string }>;
}) {
  const animate = useAnimate();
  return (
    <div aria-hidden style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLine
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={x} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip content={<TooltipBox unit={unit} />} cursor={{ stroke: GRID }} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colorOf(s, i)}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={animate}
            />
          ))}
          {markers?.map((m) => {
            const d = data.find((row) => row[x] === m.x);
            const v = d?.[m.key];
            return typeof v === 'number' ? (
              <ReferenceDot
                key={`${m.x}-${m.key}`}
                x={m.x}
                y={v}
                r={5}
                fill="var(--k-acid)"
                stroke="var(--k-on-acid)"
                strokeWidth={1.5}
              />
            ) : null;
          })}
        </RLine>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaChart({
  data,
  x,
  series,
  unit,
  height = 220,
}: {
  data: Datum[];
  x: string;
  series: Series[];
  unit?: string;
  height?: number;
}) {
  const animate = useAnimate();
  return (
    <div aria-hidden style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RArea
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={colorOf(s, i)} stopOpacity={0.25} />
                <stop offset="1" stopColor={colorOf(s, i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={x} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip content={<TooltipBox unit={unit} />} cursor={{ stroke: GRID }} />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colorOf(s, i)}
              strokeWidth={2.5}
              fill={`url(#area-${s.key})`}
              connectNulls
              isAnimationActive={animate}
            />
          ))}
        </RArea>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChart({
  data,
  x,
  series,
  unit,
  height = 220,
  stacked = false,
}: {
  data: Datum[];
  x: string;
  series: Series[];
  unit?: string;
  height?: number;
  stacked?: boolean;
}) {
  const animate = useAnimate();
  return (
    <div aria-hidden style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBar
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={x} {...axisProps} />
          <YAxis {...axisProps} width={48} allowDecimals={false} />
          <Tooltip content={<TooltipBox unit={unit} />} cursor={{ fill: 'var(--k-surface-2)' }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={colorOf(s, i)}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked ? 0 : [6, 6, 0, 0]}
              maxBarSize={36}
              isAnimationActive={animate}
            />
          ))}
        </RBar>
      </ResponsiveContainer>
    </div>
  );
}
