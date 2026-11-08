'use client';

import { useId, useState } from 'react';
import { convertWeight, DEFAULT_BAR, plateBreakdown, type PlateUnit } from '@repsy/core/plates';
import { Input } from '@/components/ui/input';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));

/** PRD D18: the plates per side for a total, and the same weight in the other unit. Works offline. */
export function PlateHelper({ name, units }: { name: string; units: PlateUnit }) {
  const id = useId();
  const [total, setTotal] = useState('');
  const [bar, setBar] = useState(DEFAULT_BAR[units]);
  const value = Number(total.replace(',', '.'));
  const result = total.trim() === '' ? null : plateBreakdown(value, units, bar);
  const other: PlateUnit = units === 'kg' ? 'lb' : 'kg';
  const bars = units === 'kg' ? [20, 15, 10] : [45, 35, 25];
  return (
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-2 text-accent">
        Plates and units<span className="sr-only"> for {name}</span>
      </summary>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-total`}>Total ({units})</label>
          <Input
            id={`${id}-total`}
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-bar`}>Bar</label>
          <select
            id={`${id}-bar`}
            value={bar}
            onChange={(e) => setBar(Number(e.target.value))}
            className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
          >
            {bars.map((b) => (
              <option key={b} value={b}>
                {b} {units}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" className="mt-2 text-secondary">
        {total.trim() === ''
          ? `Enter a total to see the plates for each side.`
          : !result
            ? `Enter at least the bar (${bar} ${units}).`
            : [
                result.perSide.length === 0
                  ? 'Just the bar.'
                  : `Each side: ${result.perSide.map(([p, c]) => `${c} × ${fmt(p)}`).join(', ')} ${units}.`,
                result.remainder > 0
                  ? `That makes ${fmt(result.loaded)} ${units}; ${fmt(result.remainder)} ${units} can't be made with standard plates.`
                  : null,
                `${fmt(value)} ${units} = ${fmt(convertWeight(value, units))} ${other}.`,
              ]
                .filter(Boolean)
                .join(' ')}
      </p>
    </details>
  );
}
