/** A stored set, with Decimals as plain numbers. */
export interface SetLogValue {
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  clientUpdatedAt: string;
}

type Decimalish = { toString(): string } | null;
const num = (d: Decimalish): number | null => (d === null ? null : Number(d.toString()));

export function toSetLogValue(row: {
  reps: number | null;
  weightKg: Decimalish;
  rpe: Decimalish;
  durationSeconds: number | null;
  distanceM: Decimalish;
  clientUpdatedAt: Date;
}): SetLogValue {
  return {
    reps: row.reps,
    weightKg: num(row.weightKg),
    rpe: num(row.rpe),
    durationSeconds: row.durationSeconds,
    distanceM: num(row.distanceM),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
  };
}
