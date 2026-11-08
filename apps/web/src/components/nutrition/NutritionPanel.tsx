'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { NutritionView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { logDayApi, setTargetApi } from '@/lib/nutrition-api';

// Local copy: client components never import runtime values from @repsy/core (server code).
const FIELDS = [
  ['calories', 'Calories', 'kcal'],
  ['proteinG', 'Protein', 'g'],
  ['carbsG', 'Carbs', 'g'],
  ['fatG', 'Fat', 'g'],
] as const;
type Key = (typeof FIELDS)[number][0];

const formatDay = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

function MacroForm({
  label,
  submit,
  initial,
  withDate,
  maxDate,
  onSave,
}: {
  label: string;
  submit: string;
  initial: Partial<Record<Key, number | null>>;
  withDate?: { label: string; value: string; min?: string };
  maxDate?: string;
  onSave: (body: Record<string, number | string | null>) => Promise<Record<string, string> | null>;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<Key, string>>(() => ({
    calories: initial.calories?.toString() ?? '',
    proteinG: initial.proteinG?.toString() ?? '',
    carbsG: initial.carbsG?.toString() ?? '',
    fatG: initial.fatG?.toString() ?? '',
  }));
  const [date, setDate] = useState(withDate?.value ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      noValidate
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, number | string | null> = {};
        for (const [k] of FIELDS) {
          const v = values[k].trim();
          body[k] = v === '' ? null : Number(v);
        }
        if (withDate) body[withDate.label === 'Date' ? 'localDate' : 'effectiveFrom'] = date;
        setBusy(true);
        const errs = await onSave(body);
        setBusy(false);
        setErrors(errs ?? {});
      }}
    >
      {withDate && (
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-4 sm:max-w-xs">
          <label htmlFor={`${id}-date`} className="text-sm font-medium">
            {withDate.label}
          </label>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            min={withDate.min}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            aria-invalid={errors.localDate || errors.effectiveFrom ? true : undefined}
          />
          {(errors.localDate || errors.effectiveFrom) && (
            <p role="alert" className="text-sm text-danger">
              {errors.localDate ?? errors.effectiveFrom}
            </p>
          )}
        </div>
      )}
      {FIELDS.map(([key, name, unit]) => (
        <div key={key} className="flex flex-col gap-1">
          <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
            {name} ({unit})
          </label>
          <Input
            id={`${id}-${key}`}
            inputMode="numeric"
            value={values[key]}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            aria-invalid={errors[key] ? true : undefined}
            aria-describedby={errors[key] ? `${id}-${key}-e` : undefined}
          />
          {errors[key] && (
            <p id={`${id}-${key}-e`} role="alert" className="text-sm text-danger">
              {errors[key]}
            </p>
          )}
        </div>
      ))}
      <div className="col-span-2 sm:col-span-4">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submit}
        </Button>
      </div>
    </form>
  );
}

/** Nutrition targets and daily totals (PRD G6/G7), for the coach (sets targets) and the client (logs days). */
export function NutritionPanel({
  clientId,
  view,
  isCoach,
}: {
  clientId: string;
  view: NutritionView;
  isCoach: boolean;
}) {
  const router = useRouter();
  const today = view.days.find((d) => d.localDate === view.todayLocalDate);
  const save =
    (fn: typeof logDayApi, ok: string) => async (body: Record<string, number | string | null>) => {
      const res = await fn(clientId, body);
      if (!res.ok) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) if (v[0]) out[k] = v[0];
        if (Object.keys(out).length === 0) toast.error(res.message);
        return out;
      }
      toast.success(ok);
      router.refresh();
      return null;
    };
  const t = view.target;
  const pct =
    view.adherence.logged > 0
      ? Math.round((view.adherence.onTarget / view.adherence.logged) * 100)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Daily targets</CardTitle>
          <CardDescription>
            {t
              ? `Set by ${isCoach ? 'you' : 'your coach'}, from ${formatDay(t.effectiveFrom)}.`
              : isCoach
                ? 'No targets yet. Set them below.'
                : 'Your coach has not set targets yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {t && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FIELDS.map(([key, name, unit]) => (
                <div key={key}>
                  <dt className="text-sm text-secondary">{name}</dt>
                  <dd className="text-lg font-semibold">
                    {t[key] === null ? '–' : `${t[key]} ${unit}`}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {isCoach && (
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline">
                {t ? 'Change targets' : 'Set targets'}
              </summary>
              <div className="mt-3">
                <MacroForm
                  label="Set targets"
                  submit="Save targets"
                  initial={t ?? {}}
                  withDate={{ label: 'Starting', value: view.todayLocalDate }}
                  onSave={save(setTargetApi, 'Targets saved.')}
                />
              </div>
            </details>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Log a day</CardTitle>
          <CardDescription>
            Totals for the day. Saving the same day again replaces it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MacroForm
            label="Log a day"
            submit="Save day"
            initial={today ?? {}}
            withDate={{ label: 'Date', value: view.todayLocalDate }}
            maxDate={view.todayLocalDate}
            onSave={save(logDayApi, 'Day saved.')}
          />
        </CardContent>
      </Card>
      <section aria-labelledby="days-heading" className="flex flex-col gap-3">
        <h2 id="days-heading" className="text-lg font-semibold">
          Last 4 weeks
        </h2>
        {pct !== null && (
          <p>
            On target {view.adherence.onTarget} of {view.adherence.logged} logged days ({pct}%),
            within 10% of each target.
          </p>
        )}
        {view.days.length === 0 ? (
          <p className="text-secondary">No days logged yet.</p>
        ) : (
          <div
            role="region"
            aria-labelledby="days-heading"
            tabIndex={0}
            className="overflow-x-auto rounded-card bg-surface shadow-card"
          >
            <table className="w-full text-left text-base">
              <thead className="border-b border-divider text-sm text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Day
                  </th>
                  {FIELDS.map(([key, name]) => (
                    <th key={key} scope="col" className="px-4 py-3 font-medium">
                      {name}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 font-medium">
                    On target
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.days.map((d) => (
                  <tr key={d.localDate} className="border-b border-divider last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal whitespace-nowrap">
                      {formatDay(d.localDate)}
                    </th>
                    {FIELDS.map(([key]) => (
                      <td key={key} className="px-4 py-2">
                        {d[key] ?? '–'}
                      </td>
                    ))}
                    <td className="px-4 py-2">
                      {d.onTarget === null ? '–' : d.onTarget ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
