'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { RunHistoryItem, StepType } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const STEP: Record<StepType, string> = {
  message: 'Message',
  form: 'Form',
  habit: 'Habit',
  tag_add: 'Add tag',
  tag_remove: 'Remove tag',
  program: 'Program',
  followup: 'Follow-up',
  course: 'Course',
};
const STATUS: Record<string, string> = {
  pending: 'Scheduled',
  waiting: 'Waiting for your OK',
  done: 'Done',
  failed: 'Couldn’t run',
  skipped: 'Skipped',
};
const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso));

/** PRD J1, J7, J8: the client's automation runs, every step's outcome, and starting one by hand. */
export function ClientAutomations({
  clientId,
  timezone,
  runs,
  sequences,
  canEdit,
}: {
  clientId: string;
  timezone: string;
  runs: RunHistoryItem[];
  sequences: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [pick, setPick] = useState(sequences[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  async function go(method: 'POST' | 'DELETE', path: string, body: unknown, done: string) {
    setBusy(true);
    const res =
      method === 'POST'
        ? await call(method, path, body)
        : await fetch(path, { method, credentials: 'same-origin' }).then((r) => ({
            ok: r.ok,
            message: "That didn't work.",
          }));
    setBusy(false);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error(res.message);
  }
  if (runs.length === 0 && (!canEdit || sequences.length === 0)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Automations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit && sequences.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-seq`} className="text-sm font-medium">
                Start an automation
              </label>
              <select
                id={`${id}-seq`}
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              disabled={busy || !pick}
              onClick={() =>
                void go(
                  'POST',
                  `/api/v1/automations/${pick}/start`,
                  { clientId },
                  'Automation started',
                )
              }
            >
              Start
            </Button>
          </div>
        )}
        {runs.map((r) => (
          <section
            key={r.runId}
            aria-label={`${r.sequenceName} run`}
            className="rounded-control border border-divider p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {r.sequenceName}{' '}
                <span className="text-sm font-normal text-secondary">
                  · started {when(r.startedAt, timezone)} ·{' '}
                  {r.status === 'active' ? 'running' : r.status}
                </span>
              </p>
              {canEdit && r.status === 'active' && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Stop ${r.sequenceName}`}
                  disabled={busy}
                  onClick={() =>
                    void go('DELETE', `/api/v1/automation-runs/${r.runId}`, null, 'Stopped')
                  }
                >
                  Stop
                </Button>
              )}
            </div>
            <ol className="mt-2 flex flex-col gap-1 text-sm">
              {r.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {STEP[s.type]} · {when(s.dueAt, timezone)} · {STATUS[s.status]}
                    {s.error && <span className="text-danger"> ({s.error})</span>}
                  </span>
                  {s.status === 'waiting' && (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        disabled={busy}
                        aria-label={`OK: ${STEP[s.type]}, ${when(s.dueAt, timezone)}`}
                        onClick={() =>
                          void go(
                            'POST',
                            `/api/v1/automation-steps/${s.id}/decide`,
                            { decision: 'approve' },
                            'Done',
                          )
                        }
                      >
                        OK
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Skip: ${STEP[s.type]}, ${when(s.dueAt, timezone)}`}
                        onClick={() =>
                          void go(
                            'POST',
                            `/api/v1/automation-steps/${s.id}/decide`,
                            { decision: 'skip' },
                            'Skipped',
                          )
                        }
                      >
                        Skip
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
