export type Units = 'kg' | 'lb';

const KG_PER_LB = 0.45359237;

/** A load stored in kg, shown in the coach's units, to one decimal place. */
export function toDisplay(kg: number, unit: Units): number {
  const v = unit === 'lb' ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

/** A load typed in the coach's units, converted to kg at three decimal places for storage. */
export function fromDisplay(value: number, unit: Units): number {
  const kg = unit === 'lb' ? value * KG_PER_LB : value;
  return Math.round(kg * 1000) / 1000;
}
