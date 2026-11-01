/**
 * PRD D18: the plates to load on each side of a bar for a total weight, and kg/lb conversion. Pure: safe in the
 * browser. Greedy from the heaviest plate, which is exact for the standard plate sets below; anything left over (a
 * total the plates can't make) is reported, never rounded away silently.
 */
export type PlateUnit = 'kg' | 'lb';

export const PLATES: Record<PlateUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5],
  lb: [45, 35, 25, 10, 5, 2.5],
};
export const DEFAULT_BAR: Record<PlateUnit, number> = { kg: 20, lb: 45 };
export const KG_PER_LB = 0.45359237;

export interface PlateBreakdown {
  /** Plates per side, heaviest first, as [plate, count]. */
  perSide: [number, number][];
  /** What the bar and plates add up to (equal to the total unless it can't be made). */
  loaded: number;
  /** Total minus loaded (0 when exact). */
  remainder: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function plateBreakdown(
  total: number,
  unit: PlateUnit,
  bar: number = DEFAULT_BAR[unit],
): PlateBreakdown | null {
  if (!Number.isFinite(total) || total < bar || total > 1000) return null;
  let side = round((total - bar) / 2);
  const perSide: [number, number][] = [];
  for (const plate of PLATES[unit]) {
    const count = Math.floor(round(side / plate));
    if (count > 0) {
      perSide.push([plate, count]);
      side = round(side - count * plate);
    }
  }
  const loaded = round(bar + 2 * perSide.reduce((n, [p, c]) => n + p * c, 0));
  return { perSide, loaded, remainder: round(total - loaded) };
}

/** `value` in the other unit, to one decimal. */
export function convertWeight(value: number, from: PlateUnit): number {
  const out = from === 'kg' ? value / KG_PER_LB : value * KG_PER_LB;
  return Math.round(out * 10) / 10;
}
