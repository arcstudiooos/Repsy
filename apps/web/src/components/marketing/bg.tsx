import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/** Landing PRD §10.1 background layers. All decorative (aria-hidden, no pointer events), tokens only. */

export function DotGrid({
  tone = 'ink',
  className,
}: {
  tone?: 'ink' | 'light' | 'onInk';
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'mk-bg mk-dots',
        tone === 'light' && 'mk-dots--light',
        tone === 'onInk' && 'mk-dots--ink',
        className,
      )}
    />
  );
}

export function LogGrid({ className }: { className?: string }) {
  return <div aria-hidden className={cn('mk-bg mk-loggrid', className)} />;
}

/** One fixed grain layer for the whole page (SVG feTurbulence, 3%, multiply). */
export function Grain() {
  return (
    <svg aria-hidden className="mk-grain size-full">
      <filter id="mk-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#mk-grain)" />
    </svg>
  );
}

/** Concentric outline rings, one with a rotating 25% arc. */
export function PlateRings({ size = 520, className }: { size?: number; className?: string }) {
  const c = size / 2;
  const radii = [c - 1, c * 0.72, c * 0.46];
  const arcR = radii[1]!;
  const circ = 2 * Math.PI * arcR;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('pointer-events-none absolute -z-10', className)}
      fill="none"
    >
      {radii.map((r) => (
        <circle
          key={r}
          cx={c}
          cy={c}
          r={r}
          stroke="var(--k-brand)"
          strokeOpacity={0.12}
          strokeWidth={1}
        />
      ))}
      <circle
        className="mk-ring-spin"
        cx={c}
        cy={c}
        r={arcR}
        stroke="var(--k-brand)"
        strokeOpacity={0.35}
        strokeWidth={1.5}
        strokeDasharray={`${circ * 0.25} ${circ}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 3–5 small acid squares (the logo motif) at fixed spots, each floating on its own phase. */
export function AcidTabs({
  spots,
}: {
  spots: Array<{ top: string; left: string; size?: number }>;
}) {
  return (
    <div aria-hidden className="mk-bg overflow-hidden">
      {spots.map((s, i) => (
        <span
          key={`${s.top}-${s.left}`}
          className="mk-tab"
          style={
            {
              top: s.top,
              left: s.left,
              width: s.size ?? 12,
              height: s.size ?? 12,
              '--mk-dur': `${6 + (i % 4)}s`,
              '--mk-delay': `${-i * 1.3}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** A thin rising progress line behind a heading; draws in on scroll. */
export function TrendLine({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      data-draw
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      className={cn('pointer-events-none absolute inset-x-0 -z-10 h-28 w-full', className)}
      fill="none"
    >
      <polyline
        pathLength={1}
        points="0,110 120,96 240,100 360,80 480,84 600,62 720,66 840,44 960,48 1080,24 1200,14"
        stroke="var(--k-brand)"
        strokeOpacity={0.15}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function RulerTicks() {
  return <div aria-hidden className="mk-ruler" />;
}

export function OutlineNumeral({ n, className }: { n: string; className?: string }) {
  return (
    <span aria-hidden className={cn('mk-numeral absolute', className)}>
      {n}
    </span>
  );
}

/** The giant outlined "Repsy" at the foot of the page; letters rise in one by one. */
export function Wordmark() {
  return (
    <div aria-hidden className="mk-wordmark flex justify-center overflow-hidden pt-8" data-reveal>
      {'Repsy'.split('').map((ch, i) => (
        <span key={i} data-reveal style={{ '--mk-i': i } as CSSProperties} className="inline-block">
          {ch}
        </span>
      ))}
    </div>
  );
}

/** Two soft glows (brand + acid) drifting on long loops; transform only. Static without motion. */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('mk-bg mk-aurora', className)}>
      <span className="mk-aurora-blob mk-aurora-blob--brand" />
      <span className="mk-aurora-blob mk-aurora-blob--acid" />
    </div>
  );
}
