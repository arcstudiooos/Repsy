'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SessionTypeView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';
import { dayKey, formatDayLabel, formatTime, SESSION_KIND_LABEL } from '@/lib/schedule-format';

/**
 * PRD K10: the client picks a session type, then an open time shown in their own zone, then confirms. A slot taken
 * meanwhile is refused by the server and the list reloads.
 */
export function BookSession({
  types,
  timeZone,
  clientId,
}: {
  types: SessionTypeView[];
  timeZone: string;
  /** Staff booking on a client's behalf. */
  clientId?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const type = types.find((t) => t.id === typeId);

  async function load(id: string) {
    setBusy(true);
    setMessage(null);
    setPicked(null);
    try {
      const q = new URLSearchParams({ sessionTypeId: id, days: '21' });
      if (clientId) q.set('clientId', clientId);
      const res = await fetch(`/api/v1/slots?${q.toString()}`, {
        credentials: 'same-origin',
      });
      const json = (await res.json().catch(() => null)) as { data?: { slots: string[] } } | null;
      setSlots(res.ok ? (json?.data?.slots ?? []) : []);
      if (!res.ok) setMessage('Could not load open times. Try again.');
    } catch {
      setMessage('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!picked || !type) return;
    setBusy(true);
    const res = await send('POST', '/api/v1/bookings', {
      sessionTypeId: type.id,
      startsAt: picked,
      ...(clientId ? { clientId } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setMessage(res.message);
      await load(type.id);
      return;
    }
    setSlots(null);
    setPicked(null);
    setMessage(
      `Booked: ${formatDayLabel(dayKey(picked, timeZone))} at ${formatTime(picked, timeZone)}.`,
    );
    router.refresh();
  }

  const days = new Map<string, string[]>();
  for (const s of slots ?? []) {
    const k = dayKey(s, timeZone);
    days.set(k, [...(days.get(k) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${uid}-type`} className="text-sm font-medium">
            Session
          </label>
          <select
            id={`${uid}-type`}
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              setSlots(null);
            }}
            className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.durationMin} min)
              </option>
            ))}
          </select>
        </div>
        <Button variant="secondary" disabled={busy || !typeId} onClick={() => void load(typeId)}>
          See open times
        </Button>
      </div>
      {type && (
        <p className="text-sm text-secondary">
          {SESSION_KIND_LABEL[type.kind]}
          {type.usesCredit && ' · uses one session credit'}
          {type.cancelWindowHours > 0 &&
            ` · cancel here up to ${type.cancelWindowHours} hours before`}
          . Times are in {timeZone.replace(/_/g, ' ')}.
        </p>
      )}
      {slots !== null &&
        (slots.length === 0 ? (
          <p className="text-secondary">
            No open times in the next three weeks.{clientId ? '' : ' Message your coach.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {[...days.entries()].map(([k, list]) => (
              <fieldset key={k} className="flex flex-col gap-2">
                <legend className="mb-1 font-medium">{formatDayLabel(k)}</legend>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={picked === s ? 'default' : 'secondary'}
                      aria-pressed={picked === s}
                      onClick={() => setPicked(s)}
                    >
                      {formatTime(s, timeZone)}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        ))}
      {picked && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy} onClick={() => void book()}>
            Book {formatDayLabel(dayKey(picked, timeZone))} at {formatTime(picked, timeZone)}
          </Button>
        </div>
      )}
      <p role="status" className="text-sm text-secondary">
        {message}
      </p>
    </div>
  );
}
