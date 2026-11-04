'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  daysBetween,
  inRange,
  niceTicks,
  RANGES,
  rangeStart,
  trailingAverage,
  type RangeWeeks,
  type TrendPoint,
} from '@/lib/trend';
import { cn } from '@/lib/utils';

// Emphasis form: the series that matters wears the accent; context readings wear the de-emphasis gray.
const ACCENT = 'var(--k-accent)';
const CONTEXT = 'var(--k-secondary)';
const GRID = 'var(--k-divider)';
const SURFACE = 'var(--k-surface)';

/** Drawn at the container's real width so 12px labels stay 12px on phones. */
const DEFAULT_W = 640;
const H = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 48 };

const fmtDay = (d: string, withYear = false) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const fmtNum = (v: number) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(v);

export interface TrendChartProps {
  /** Names the series, e.g. "Body weight". The chart title. */
  title: string;
  /** Shown after values, e.g. "kg". */
  unit: string;
  /** Every reading, already in display units; the range filter works on them here. */
  points: TrendPoint[];
  today: string;
  /** Plot a 7-day average line over the daily readings (body weight). */
  sevenDayAverage?: boolean;
  defaultRange?: RangeWeeks;
}

/**
 * A progress trend (PRD E2): 4, 12, 26 or 52 weeks ending today, with a crosshair tooltip (pointer or arrow keys)
 * and the same numbers as a table. With `sevenDayAverage`, the average is the line and the daily readings are dots.
 */
export function TrendChart({
  title,
  unit,
  points,
  today,
  sevenDayAverage = false,
  defaultRange = 12,
}: TrendChartProps) {
  const id = useId();
  const [range, setRange] = useState<RangeWeeks>(defaultRange);
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(DEFAULT_W);
  const start = rangeStart(today, range);
  const shown = useMemo(() => inRange(points, start), [points, start]);
  const average = useMemo(
    () => (sevenDayAverage ? inRange(trailingAverage(points), start) : []),
    [points, start, sevenDayAverage],
  );
  const line = sevenDayAverage ? average : shown;
  const hasData = shown.length > 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const values = [...shown, ...average].map((p) => p.value);
  const ticks = values.length ? niceTicks(Math.min(...values), Math.max(...values)) : [];
  const yMin = ticks[0] ?? 0;
  const yMax = ticks[ticks.length - 1] ?? 1;
  const span = Math.max(1, daysBetween(start, today));
  const x = (d: string) => PAD.left + (daysBetween(start, d) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const path = line
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join('');
  const xTicks = [start, rangeStart(today, Math.ceil(range / 2)), today];

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!shown.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    shown.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(shown[best]!.date) - px)) best = i;
    });
    setActive(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!shown.length) return;
    const last = shown.length - 1;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in step) {
      e.preventDefault();
      const by = step[e.key]!;
      setActive((a) => (a === null ? last : Math.min(last, Math.max(0, a + by))));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : last);
    } else if (e.key === 'Escape') setActive(null);
  };
  const point = active !== null ? shown[active] : undefined;
  const avgAt = point ? average.find((a) => a.date === point.date) : undefined;
  const latest = line[line.length - 1];

  return (
    <figure className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id={`${id}-title`} className="font-semibold">
          {title}
          {latest && (
            <span className="ml-2 font-normal text-secondary">
              {sevenDayAverage ? '7-day average ' : 'latest '}
              {fmtNum(latest.value)} {unit}
            </span>
          )}
        </figcaption>
        <div role="group" aria-label={`${title}: time range`} className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => {
                setRange(r);
                setActive(null);
              }}
              className={cn(
                'min-h-11 rounded-control px-3 text-sm font-medium md:min-h-9',
                r === range ? 'bg-ink text-surface' : 'text-secondary hover:bg-canvas',
              )}
            >
              {r}w
            </button>
          ))}
        </div>
      </div>
      {sevenDayAverage && shown.length > 0 && (
        <ul className="flex flex-wrap gap-4 text-sm text-secondary" aria-label="Legend">
          <li className="flex items-center gap-2">
            <svg width="20" height="8" aria-hidden>
              <line
                x1="0"
                y1="4"
                x2="20"
                y2="4"
                stroke={ACCENT}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            7-day average
          </li>
          <li className="flex items-center gap-2">
            <svg width="10" height="10" aria-hidden>
              <circle cx="5" cy="5" r="4" fill={CONTEXT} />
            </svg>
            Daily reading
          </li>
        </ul>
      )}
      {shown.length === 0 ? (
        <p className="text-secondary">No readings in the last {range} weeks.</p>
      ) : (
        <div className="relative" ref={box}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block max-w-full touch-pan-y rounded-control focus-visible:outline-2 focus-visible:outline-accent"
            role="img"
            aria-label={`${title}, last ${range} weeks: ${shown.length} readings. Use the arrow keys to read values, or open the table below.`}
            tabIndex={0}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={GRID}
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize="12"
                  fill={CONTEXT}
                >
                  {fmtNum(v)}
                </text>
              </g>
            ))}
            {xTicks.map((d, i) => (
              <text
                key={d}
                x={x(d)}
                y={H - 8}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                fontSize="12"
                fill={CONTEXT}
              >
                {fmtDay(d)}
              </text>
            ))}
            {point && (
              <line
                x1={x(point.date)}
                x2={x(point.date)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={CONTEXT}
                strokeWidth="1"
              />
            )}
            {sevenDayAverage &&
              shown.map((p) => (
                <circle
                  key={p.date}
                  cx={x(p.date)}
                  cy={y(p.value)}
                  r="4"
                  fill={CONTEXT}
                  stroke={SURFACE}
                  strokeWidth="2"
                />
              ))}
            {line.length > 1 && (
              <path
                d={path}
                fill="none"
                stroke={ACCENT}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {!sevenDayAverage &&
              shown.map((p, i) => (
                <circle
                  key={p.date}
                  cx={x(p.date)}
                  cy={y(p.value)}
                  r={i === active ? 6 : 4}
                  fill={ACCENT}
                  stroke={SURFACE}
                  strokeWidth="2"
                />
              ))}
            {point && sevenDayAverage && avgAt && (
              <circle
                cx={x(point.date)}
                cy={y(avgAt.value)}
                r="6"
                fill={ACCENT}
                stroke={SURFACE}
                strokeWidth="2"
              />
            )}
          </svg>
          {point && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 rounded-control bg-surface px-3 py-2 text-sm whitespace-nowrap shadow-card"
              style={{
                left: `${(x(point.date) / W) * 100}%`,
                transform: `translateX(${x(point.date) > W / 2 ? 'calc(-100% - 8px)' : '8px'})`,
              }}
            >
              <span className="block font-medium">{fmtDay(point.date, true)}</span>
              <span className="block">
                {fmtNum(point.value)} {unit}
              </span>
              {avgAt && (
                <span className="block text-secondary">
                  7-day average {fmtNum(avgAt.value)} {unit}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline">
            Show as a table
          </summary>
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">
              {title}, last {range} weeks
            </caption>
            <thead className="text-secondary">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1 font-medium">
                  {unit}
                </th>
                {sevenDayAverage && (
                  <th scope="col" className="py-1 font-medium">
                    7-day average
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((p) => (
                <tr key={p.date} className="border-t border-divider">
                  <th scope="row" className="py-1 font-normal">
                    {fmtDay(p.date, true)}
                  </th>
                  <td className="py-1">{fmtNum(p.value)}</td>
                  {sevenDayAverage && (
                    <td className="py-1">
                      {fmtNum(average.find((a) => a.date === p.date)?.value ?? p.value)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
