/**
 * Workout blocks (PRD C8): supersets, circuits, intervals, AMRAP, EMOM and for-time. Pure: safe in the browser.
 *
 * An exercise either starts a block (it may carry a `block` spec) or joins the one above it (`groupWithPrevious`).
 * A run of joined exercises with no spec on its first one is a superset. Labels (A, B1, B2...) are derived, never
 * stored, and appear only on workouts that use blocks, so plain workouts look as before.
 */
import { z } from 'zod';

export const BLOCK_FORMATS = [
  'superset',
  'circuit',
  'interval',
  'amrap',
  'emom',
  'for_time',
] as const;
export type BlockFormat = (typeof BLOCK_FORMATS)[number];

export const BLOCK_FORMAT_LABEL: Record<BlockFormat, string> = {
  superset: 'Superset',
  circuit: 'Circuit',
  interval: 'Intervals',
  amrap: 'AMRAP',
  emom: 'EMOM',
  for_time: 'For time',
};

export interface BlockSpec {
  format: BlockFormat;
  rounds?: number;
  workSec?: number;
  restSec?: number;
  minutes?: number;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max).optional();

export const blockSpecSchema = z
  .strictObject({
    format: z.enum(BLOCK_FORMATS),
    rounds: int(1, 50),
    workSec: int(5, 3600),
    restSec: int(0, 3600),
    minutes: int(1, 120),
  })
  .superRefine((b, ctx) => {
    const need = (field: keyof BlockSpec, message: string) => {
      if (b[field] === undefined) ctx.addIssue({ code: 'custom', path: [field], message });
    };
    if (b.format === 'circuit') need('rounds', 'Enter the rounds.');
    if (b.format === 'interval') {
      need('rounds', 'Enter the rounds.');
      need('workSec', 'Enter the work time.');
      need('restSec', 'Enter the rest time.');
    }
    if (b.format === 'amrap' || b.format === 'emom') need('minutes', 'Enter the minutes.');
  });

/** A stored block spec, or null when absent or unreadable. */
export function readBlock(value: unknown): BlockSpec | null {
  if (value === null || value === undefined) return null;
  const parsed = blockSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Only the fields that apply to the format, so equal blocks always serialize (and hash) identically. */
export function cleanBlock(b: BlockSpec): BlockSpec {
  const out: BlockSpec = { format: b.format };
  const keep: Record<BlockFormat, (keyof BlockSpec)[]> = {
    superset: ['rounds'],
    circuit: ['rounds'],
    interval: ['rounds', 'workSec', 'restSec'],
    amrap: ['minutes'],
    emom: ['minutes'],
    for_time: ['rounds', 'minutes'],
  };
  for (const k of keep[b.format])
    if (b[k] !== undefined) (out as unknown as Record<string, number>)[k] = b[k] as number;
  return out;
}

interface Blocky {
  groupWithPrevious?: boolean | null;
  block?: BlockSpec | null;
}

const letter = (n: number) => (n < 26 ? String.fromCharCode(65 + n) : `Z${n - 25}`);

/** True when any exercise starts or joins a block. */
export const usesBlocks = (items: readonly Blocky[]) =>
  items.some((i) => i.groupWithPrevious || i.block);

/**
 * Per exercise: its label ("A", "B1", "B2") and, on the first exercise of a block, the block's description. All null
 * when the workout uses no blocks.
 */
export function blockLayout(
  items: readonly Blocky[],
): { label: string | null; heading: string | null }[] {
  if (!usesBlocks(items)) return items.map(() => ({ label: null, heading: null }));
  const groups: number[][] = [];
  items.forEach((item, i) => {
    if (item.groupWithPrevious && groups.length > 0) groups[groups.length - 1]!.push(i);
    else groups.push([i]);
  });
  const out = items.map(() => ({ label: null as string | null, heading: null as string | null }));
  groups.forEach((g, gi) => {
    const head = items[g[0]!]!;
    const spec = head.block ?? (g.length > 1 ? { format: 'superset' as const } : null);
    g.forEach((idx, k) => {
      out[idx]!.label = g.length > 1 ? `${letter(gi)}${k + 1}` : letter(gi);
    });
    if (spec) out[g[0]!]!.heading = `${letter(gi)} · ${describeBlock(spec)}`;
  });
  return out;
}

/** "Superset · 3 rounds", "Intervals · 40 s on / 20 s off × 8", "AMRAP 12 min", "For time · 3 rounds (cap 20 min)". */
export function describeBlock(b: BlockSpec): string {
  const rounds = b.rounds ? ` · ${b.rounds} ${b.rounds === 1 ? 'round' : 'rounds'}` : '';
  switch (b.format) {
    case 'superset':
    case 'circuit':
      return `${BLOCK_FORMAT_LABEL[b.format]}${rounds}`;
    case 'interval':
      return `Intervals · ${b.workSec ?? 0} s on / ${b.restSec ?? 0} s off × ${b.rounds ?? 1}`;
    case 'amrap':
    case 'emom':
      return `${BLOCK_FORMAT_LABEL[b.format]} ${b.minutes ?? 0} min`;
    case 'for_time':
      return `For time${rounds}${b.minutes ? ` (cap ${b.minutes} min)` : ''}`;
  }
}
