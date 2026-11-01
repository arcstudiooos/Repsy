'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { setCheckinWeekday } from '@/lib/checkin-api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const EVERY = [
  [1, 'Every week'],
  [2, 'Every 2 weeks'],
  [4, 'Every 4 weeks'],
] as const;

/** The client's check-in weekday (S4-1) and how often (PRD F4). A change applies from the next check-in. */
export function CheckinSchedule({
  clientId,
  weekday,
  everyWeeks = 1,
  templateId = null,
  templates = [],
  disabled,
}: {
  clientId: string;
  weekday: number | null;
  everyWeeks?: number;
  /** PRD F2: the client's recurring template (null = the default) and the choices. */
  templateId?: string | null;
  templates?: { id: string; title: string; isDefault: boolean }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(weekday === null ? '' : String(weekday));
  const [every, setEvery] = useState(everyWeeks);
  const initialTemplate = templateId ?? templates.find((t) => t.isDefault)?.id ?? '';
  const [tpl, setTpl] = useState(initialTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await setCheckinWeekday(
      clientId,
      value === '' ? null : Number(value),
      every,
      templates.length > 1 && tpl ? tpl : undefined,
    );
    setBusy(false);
    if (res.ok) {
      toast.success(value === '' ? 'Weekly check-ins turned off' : 'Check-in day saved');
      router.refresh();
    } else {
      setError(res.message);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Check-in day
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
        >
          <option value="">No weekly check-in</option>
          {DAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
        {value !== '' && templates.length > 1 && (
          <>
            <label htmlFor={`${id}-tpl`} className="sr-only">
              Check-in questions
            </label>
            <select
              id={`${id}-tpl`}
              value={tpl}
              disabled={disabled}
              onChange={(e) => setTpl(e.target.value)}
              className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </>
        )}
        {value !== '' && (
          <>
            <label htmlFor={`${id}-every`} className="sr-only">
              How often
            </label>
            <select
              id={`${id}-every`}
              value={every}
              disabled={disabled}
              onChange={(e) => setEvery(Number(e.target.value))}
              className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              {EVERY.map(([n, label]) => (
                <option key={n} value={n}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          variant="secondary"
          onClick={() => void save()}
          disabled={
            busy ||
            disabled ||
            (value === (weekday === null ? '' : String(weekday)) &&
              every === everyWeeks &&
              tpl === initialTemplate)
          }
        >
          Save day
        </Button>
      </div>
      <p className="text-sm text-secondary">
        Sent at 06:00 in the client&apos;s time zone and due by 23:59 that day. A new day applies
        from the next check-in.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
