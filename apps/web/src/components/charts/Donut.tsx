/** A donut of parts (server SVG) with a centre figure. Pair with a legend; segments are never the only signal. */
export function Donut({
  parts,
  size = 140,
  stroke = 18,
  centre,
  centreLabel,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
  size?: number;
  stroke?: number;
  centre?: string;
  centreLabel?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div
      aria-hidden
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--k-surface-2)"
          strokeWidth={stroke}
        />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={p.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="tabular text-h1 font-semibold">{centre ?? '–'}</span>
        {centreLabel && <span className="mt-1 text-micro text-secondary">{centreLabel}</span>}
      </span>
    </div>
  );
}
