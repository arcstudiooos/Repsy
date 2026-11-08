'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { MetricsView } from '@repsy/core';
import {
  BODY_METRICS,
  metricDef,
  metricFromCanonical,
  metricUnit,
  type BodyMetric,
} from '@repsy/core/metric-catalog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { recordMetricValue } from '@/lib/metric-api';
import { TrendChart } from './TrendChart';

const formatDay = (date: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

const fieldClass =
  'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink aria-invalid:border-danger';

function RecordForm({
  clientId,
  view,
  isCoach,
}: {
  clientId: string;
  view: MetricsView;
  isCoach: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [metric, setMetric] = useState<BodyMetric>('weight');
  const [measuredOn, setMeasuredOn] = useState(view.todayLocalDate);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const def = metricDef(metric);
  const unit = metricUnit(def.kind, view.units);
  const existing = view.series
    .find((s) => s.metric === metric)
    ?.entries.find((e) => e.measuredOn === measuredOn);
  const needsReason = isCoach && existing !== undefined;

  const err = (field: string) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} role="alert" className="text-sm text-danger">
        {errors[field]}
      </p>
    ) : null;
  const described = (field: string) => (errors[field] ? `${id}-${field}-error` : undefined);

  return (
    <form
      noValidate
      aria-label="Record a measurement"
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = Number(value.replace(',', '.'));
        if (value.trim() === '' || !Number.isFinite(n)) {
          setErrors({ value: 'Enter a number.' });
          return;
        }
        setBusy(true);
        const res = await recordMetricValue(clientId, {
          metric,
          measuredOn,
          value: n,
          ...(needsReason ? { reason } : {}),
        });
        setBusy(false);
        if (!res.ok) {
          const fe = res.fieldErrors ?? {};
          const next: Record<string, string> = {};
          for (const k of ['metric', 'measuredOn', 'value', 'reason']) {
            if (fe[k]?.[0]) next[k] = fe[k][0];
          }
          if (Object.keys(next).length === 0) toast.error(res.message);
          setErrors(next);
          return;
        }
        setErrors({});
        setValue('');
        setReason('');
        toast.success(`${def.label} saved.`);
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-metric`} className="text-sm font-medium">
          Measurement
        </label>
        <select
          id={`${id}-metric`}
          value={metric}
          onChange={(e) => setMetric(e.target.value as BodyMetric)}
          className={fieldClass}
        >
          {BODY_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-date`} className="text-sm font-medium">
          Date
        </label>
        <Input
          id={`${id}-date`}
          type="date"
          value={measuredOn}
          max={view.todayLocalDate}
          onChange={(e) => setMeasuredOn(e.target.value)}
          aria-invalid={errors.measuredOn ? true : undefined}
          aria-describedby={described('measuredOn')}
        />
        {err('measuredOn')}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-value`} className="text-sm font-medium">
          Value ({unit})
        </label>
        <Input
          id={`${id}-value`}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={errors.value ? true : undefined}
          aria-describedby={described('value')}
        />
        {existing && (
          <p className="text-sm text-secondary">
            Saved for this day: {metricFromCanonical(def.kind, existing.value, view.units)} {unit}.
            Saving again replaces it.
          </p>
        )}
        {err('value')}
      </div>
      {needsReason && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            Reason for the change (coaches only)
          </label>
          <Input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={described('reason')}
          />
          {err('reason')}
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save measurement'}
        </Button>
      </div>
    </form>
  );
}

/** Body metrics (PRD E1): latest value per metric with its change, the full history, and a form to record one. */
export function MetricsPanel({
  clientId,
  view,
  isCoach,
}: {
  clientId: string;
  view: MetricsView;
  isCoach: boolean;
}) {
  return (
    <section aria-labelledby="metrics-heading" className="flex flex-col gap-4">
      <h2 id="metrics-heading" className="text-lg font-semibold">
        Body metrics
      </h2>
      {view.series.length === 0 ? (
        <p className="text-secondary">
          No measurements yet.{' '}
          {isCoach ? 'Record one below, or ask the client to.' : 'Record your first one below.'}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Latest measurements">
          {view.series.map(({ metric, entries }) => {
            const def = metricDef(metric);
            const unit = metricUnit(def.kind, view.units);
            const show = (v: number) => metricFromCanonical(def.kind, v, view.units);
            const [latest, previous] = entries;
            const change =
              latest && previous
                ? Math.round((show(latest.value) - show(previous.value)) * 10) / 10
                : null;
            return (
              <li key={metric}>
                <Card className="h-full">
                  <CardHeader className="mb-2">
                    <CardTitle as="h3" className="text-base">
                      {def.label}
                    </CardTitle>
                    {latest && <CardDescription>{formatDay(latest.measuredOn)}</CardDescription>}
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {latest && (
                      <p>
                        <span className="text-2xl font-semibold">{show(latest.value)}</span>{' '}
                        <span className="text-secondary">{unit}</span>
                        {latest.edited && (
                          <span className="ml-2 text-sm text-secondary">Edited</span>
                        )}
                      </p>
                    )}
                    {change !== null && previous && (
                      <p className="text-sm text-secondary">
                        {change > 0 ? '+' : ''}
                        {change} {unit} since {formatDay(previous.measuredOn)}
                      </p>
                    )}
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent underline">
                        History ({entries.length})
                      </summary>
                      <table className="mt-2 w-full text-left text-sm">
                        <caption className="sr-only">{def.label} history</caption>
                        <thead className="text-secondary">
                          <tr>
                            <th scope="col" className="py-1 font-medium">
                              Date
                            </th>
                            <th scope="col" className="py-1 font-medium">
                              {unit}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((e) => (
                            <tr key={e.id} className="border-t border-divider">
                              <th scope="row" className="py-1 font-normal">
                                {formatDay(e.measuredOn)}
                              </th>
                              <td className="py-1">{show(e.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {view.series.some((x) => x.entries.length > 1) && (
        <Card>
          <CardHeader>
            <CardTitle as="h3">Trends</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-8">
            {view.series
              .filter((x) => x.entries.length > 1)
              .map(({ metric, entries }) => {
                const def = metricDef(metric);
                return (
                  <TrendChart
                    key={metric}
                    title={def.label}
                    unit={metricUnit(def.kind, view.units)}
                    today={view.todayLocalDate}
                    sevenDayAverage={metric === 'weight'}
                    points={entries.map((e) => ({
                      date: e.measuredOn,
                      value: metricFromCanonical(def.kind, e.value, view.units),
                    }))}
                  />
                );
              })}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Record a measurement</CardTitle>
          <CardDescription>
            One value per measurement and day, in{' '}
            {view.units === 'lb' ? 'pounds and inches' : 'kilograms and centimetres'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecordForm clientId={clientId} view={view} isCoach={isCoach} />
        </CardContent>
      </Card>
    </section>
  );
}
