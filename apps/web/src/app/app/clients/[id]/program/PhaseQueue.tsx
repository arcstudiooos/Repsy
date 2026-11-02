'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { PhaseView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const SELECT =
  'block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/**
 * PRD C17, J5: what runs after the current program. Each phase starts the day after the one before it ends, on the
 * same training days, either on its own or after the coach says so (it then shows in Review).
 */
export function PhaseQueue({
  clientId,
  phases,
  templates,
}: {
  clientId: string;
  phases: PhaseView[];
  templates: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await call('POST', `/api/v1/clients/${clientId}/phases`, {
      templateProgramId: String(data.get('templateProgramId')),
      mode: String(data.get('mode')),
    });
    setBusy(false);
    if (!res.ok) return setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
    toast.success('Added to the queue');
    router.refresh();
  }
  async function act(path: string, method: 'POST' | 'DELETE', done: string) {
    setBusy(true);
    const res =
      method === 'POST'
        ? await call(method, path, {})
        : await fetch(path, { method, credentials: 'same-origin' }).then((r) => ({
            ok: r.ok,
            message: "That didn't work. Try again.",
          }));
    setBusy(false);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error(res.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Next phases</CardTitle>
        <CardDescription>
          Queue programs to run in order. Each starts the day after the one before it ends, on the
          same training days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {phases.length > 0 && (
          <ol aria-label="Queued phases" className="flex flex-col divide-y divide-divider">
            {phases.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i + 1}. {p.title}{' '}
                  <span className="text-sm text-secondary">
                    · {p.mode === 'auto' ? 'starts on its own' : 'asks you first'}
                  </span>
                </span>
                <span className="flex gap-2">
                  {i === 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      aria-label={`Start now: ${p.title}`}
                      onClick={() =>
                        void act(`/api/v1/phases/${p.id}/start`, 'POST', 'Phase started')
                      }
                    >
                      Start now
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${p.title} from the queue`}
                    onClick={() => void act(`/api/v1/phases/${p.id}`, 'DELETE', 'Removed')}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {templates.length > 0 && (
          <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-tpl`} className="text-sm font-medium">
                Then run
              </label>
              <select id={`${id}-tpl`} name="templateProgramId" className={`${SELECT} max-w-full`}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-mode`} className="text-sm font-medium">
                When it&apos;s time
              </label>
              <select id={`${id}-mode`} name="mode" defaultValue="auto" className={SELECT}>
                <option value="auto">Start it automatically</option>
                <option value="approve">Ask me first</option>
              </select>
            </div>
            <Button type="submit" disabled={busy}>
              Add to queue
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
