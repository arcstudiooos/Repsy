'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import type { ProgressReportView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const label = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

/** The last 12 months up to `today`'s, newest first, as YYYY-MM. */
function lastMonths(today: string): string[] {
  let [y, m] = today.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/**
 * PRD E10: monthly progress reports as PDFs. Coaches write a summary and choose whether photos go in; the client
 * gets a message when it is ready and downloads it from Progress.
 */
export function ProgressReports({
  clientId,
  reports,
  today,
}: {
  /** Set on the coach side (who can create reports); null for the client. */
  clientId: string | null;
  reports: ProgressReportView[];
  today: string;
}) {
  const router = useRouter();
  const id = useId();
  const months = useMemo(() => lastMonths(today), [today]);
  const [month, setMonth] = useState(months[1] ?? months[0]!);
  const existing = reports.find((r) => r.month === month);
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [photos, setPhotos] = useState(existing?.includePhotos ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!clientId && reports.length === 0) return null;

  function pick(m: string) {
    setMonth(m);
    const r = reports.find((x) => x.month === m);
    setSummary(r?.summary ?? '');
    setPhotos(r?.includePhotos ?? false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await call<ProgressReportView & { created: boolean }>(
      'POST',
      `/api/v1/clients/${clientId}/progress-reports`,
      { month, summary, includePhotos: photos },
    );
    setBusy(false);
    if (!res.ok) {
      setError(
        res.fieldErrors ? (Object.values(res.fieldErrors)[0]?.[0] ?? res.message) : res.message,
      );
      return;
    }
    toast.success(
      res.data.created ? 'Report created; your client has been told' : 'Report updated',
    );
    router.refresh();
  }

  async function remove(r: ProgressReportView) {
    const res = await fetch(`/api/v1/progress-reports/${r.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast.success('Report deleted');
      router.refresh();
    } else toast.error("Couldn't delete it. Try again.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Monthly reports</CardTitle>
        <CardDescription>
          A PDF of the month: workouts, check-ins, measurements, personal records
          {clientId
            ? ', photos if you include them, and your summary.'
            : ' and your coach’s notes.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {clientId && (
          <div className="flex flex-col gap-3">
            <label htmlFor={`${id}-month`} className="text-sm font-medium">
              Month
            </label>
            <select
              id={`${id}-month`}
              value={month}
              onChange={(e) => pick(e.target.value)}
              className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-summary`} className="text-sm font-medium">
              Your summary for the month
            </label>
            <textarea
              id={`${id}-summary`}
              rows={4}
              maxLength={4000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
            />
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-accent"
                checked={photos}
                onChange={(e) => setPhotos(e.target.checked)}
              />
              Include the month’s latest progress photos
            </label>
            <div>
              <Button disabled={busy} onClick={() => void save()}>
                {existing ? 'Update report' : 'Create report'}
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
        )}
        {reports.length > 0 && (
          <ul aria-label="Reports" className="flex flex-col divide-y divide-divider">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a
                  href={`/api/v1/progress-reports/${r.id}/pdf`}
                  download
                  className="min-h-11 content-center text-accent underline underline-offset-4"
                >
                  {r.monthLabel} report (PDF)
                </a>
                {clientId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete the ${r.monthLabel} report`}
                    onClick={() => void remove(r)}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
