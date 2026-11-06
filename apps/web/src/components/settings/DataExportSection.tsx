'use client';

import { useEffect, useState } from 'react';
import type { ExportView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { exportLinks, listExports, requestExport } from '@/lib/export-api';
import { LocalTime } from '@/components/time/LocalTime';

const POLL_MS = 5000;
const STATUS: Record<ExportView['status'], string> = {
  queued: 'Preparing',
  running: 'Preparing',
  done: 'Ready',
  failed: "Couldn't be prepared",
};

/**
 * Self-serve CSV export (S5-2): an owner exports the organization, a client their own data. The files are prepared
 * by the worker; each download link works for 15 minutes and only for the person who asked.
 */
export function DataExportSection({
  scope,
  initial,
  children,
}: {
  scope: 'org' | 'client_self';
  initial: ExportView[];
  /** Extra actions beside the export (the client's deletion request). */
  children?: React.ReactNode;
}) {
  const [exports, setExports] = useState(initial.filter((e) => e.scope === scope));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preparing = exports.some((e) => e.status === 'queued' || e.status === 'running');

  useEffect(() => {
    if (!preparing) return;
    const timer = window.setInterval(async () => {
      const res = await listExports();
      if (res.ok) setExports(res.data.filter((e) => e.scope === scope));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [preparing, scope]);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await requestExport(scope, crypto.randomUUID());
    setBusy(false);
    if (res.ok) setExports((xs) => [res.data, ...xs.filter((x) => x.id !== res.data.id)]);
    else setError(res.message);
  }

  async function download(id: string, name: string) {
    setError(null);
    const res = await exportLinks(id);
    const link = res.ok ? res.data.find((l) => l.name === name) : undefined;
    if (link) window.location.assign(link.url);
    else setError(res.ok ? 'This file is no longer available.' : res.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{scope === 'org' ? 'Export organization data' : 'Your data'}</CardTitle>
        <CardDescription>
          {scope === 'org'
            ? 'CSV files of your clients, workouts, logged sets and check-ins.'
            : 'CSV files of your profile, workouts, logged sets, check-ins and messages.'}{' '}
          Files stay available for 7 days; each download link works for 15 minutes, only for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void start()}
            disabled={busy || preparing}
          >
            {scope === 'org' ? 'Export organization data' : 'Download my data'}
          </Button>
          {children}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {exports.length > 0 && (
          <ul aria-label="Your exports" className="flex flex-col gap-3">
            {exports.map((e) => (
              <li key={e.id} className="rounded-control border border-input-border p-3">
                <p className="text-sm">
                  <span className="font-medium" role="status">
                    {STATUS[e.status]}
                  </span>{' '}
                  · requested <LocalTime iso={e.createdAt} />
                </p>
                {e.files.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {e.files.map((f) => (
                      <li key={f.name}>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="min-h-11"
                          aria-label={`Download ${f.name} (${f.rows} rows)`}
                          onClick={() => void download(e.id, f.name)}
                        >
                          {f.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
