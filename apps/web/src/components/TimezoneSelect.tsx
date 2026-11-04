'use client';

import { useEffect, useMemo, useState } from 'react';
import { inputClass, RequiredMark } from '@/components/auth-ui';
import { useTimezones } from '@/components/settings/form';

/** "GMT+05:30" for a zone right now, or "" when the runtime can't say. */
function offsetOf(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return part === 'GMT' ? 'GMT+00:00' : (part ?? '').replace(/^GMT([+-])(\d)(?=$|:)/, 'GMT$10$2');
  } catch {
    return '';
  }
}

/**
 * Time-zone dropdown: every IANA zone, labelled with its current GMT offset, preselected to the browser's zone.
 * The server renders only UTC (it can't know the visitor's zone); the full list fills in on the client.
 */
export function TimezoneSelect({
  name,
  label,
  error,
  hint,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
}) {
  const zones = useTimezones();
  const [value, setValue] = useState('UTC');
  useEffect(() => {
    // Read once after mount: the server can't know the visitor's zone.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);
  const options = useMemo(() => {
    const now = new Date();
    const list = zones.length ? zones : ['UTC'];
    const withValue = list.includes(value) ? list : [value, ...list];
    return withValue.map((zone) => {
      const offset = offsetOf(zone, now);
      return { zone, label: offset ? `(${offset}) ${zone.replace(/_/g, ' ')}` : zone };
    });
  }, [zones, value]);
  const describedBy = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ');
  return (
    <div className="mb-4">
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        <RequiredMark />
      </label>
      <select
        id={name}
        name={name}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      >
        {options.map((o) => (
          <option key={o.zone} value={o.zone}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-sm text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
