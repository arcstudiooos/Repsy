import type { Guide } from '@repsy/core';

/**
 * PRD E5: guide lines drawn over an assessment photo so posture is easy to judge and repeat. Decorative: the photo's
 * alt text carries the meaning.
 */
export function GuideOverlay({ guide }: { guide: Guide }) {
  if (guide === 'none') return null;
  const lines =
    guide === 'plumb_line'
      ? [
          { x1: 50, y1: 0, x2: 50, y2: 100, strong: true },
          { x1: 0, y1: 25, x2: 100, y2: 25 },
          { x1: 0, y1: 50, x2: 100, y2: 50 },
          { x1: 0, y1: 75, x2: 100, y2: 75 },
        ]
      : [12.5, 25, 37.5, 50, 62.5, 75, 87.5].flatMap((v) => [
          { x1: v, y1: 0, x2: v, y2: 100, strong: v === 50 },
          { x1: 0, y1: v, x2: 100, y2: v },
        ]);
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full text-accent"
    >
      {lines.map(({ strong, ...l }, i) => (
        <line
          key={i}
          {...l}
          stroke="currentColor"
          strokeWidth={strong ? 2 : 1}
          strokeOpacity={strong ? 0.9 : 0.55}
          strokeDasharray={strong ? undefined : '3 3'}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export const GUIDE_LABEL: Record<Guide, string> = {
  posture_grid: 'Posture grid',
  plumb_line: 'Plumb line',
  none: 'No guide lines',
};
