'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SetupChecklist as Checklist } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { call } from '@/lib/checkin-api';

async function setHidden(hidden: boolean) {
  return call<{ hidden: boolean }>('PUT', '/api/v1/settings/setup-checklist', { hidden });
}

/** First-week setup steps on the coach dashboard (PRD A5). Steps tick themselves from what exists. */
export function SetupChecklist({ checklist }: { checklist: Checklist }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = checklist.steps.length;

  async function toggle(hidden: boolean) {
    setBusy(true);
    setError(null);
    const res = await setHidden(hidden);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  if (checklist.hidden) {
    if (!checklist.dismissed) return null;
    return (
      <p className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => toggle(false)} disabled={busy}>
          Show the setup checklist ({checklist.doneCount} of {total} done)
        </Button>
      </p>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          Get set up ({checklist.doneCount} of {total} done)
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => toggle(true)} disabled={busy}>
          Hide checklist
        </Button>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-2 overflow-hidden rounded-full bg-canvas"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={checklist.doneCount}
        >
          <div
            className="h-full bg-accent"
            style={{ width: `${(checklist.doneCount / total) * 100}%` }}
          />
        </div>
        <ol className="flex flex-col divide-y divide-divider">
          {checklist.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-sm ${
                  s.done ? 'border-accent bg-accent text-white' : 'border-input-border'
                }`}
              >
                {s.done ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                {s.done ? (
                  <span className="font-medium text-secondary line-through">
                    {s.title}
                    <span className="sr-only"> (done)</span>
                  </span>
                ) : (
                  <Link href={s.href} className="font-medium underline underline-offset-4">
                    {s.title}
                  </Link>
                )}
                {!s.done && <span className="block text-sm text-secondary">{s.body}</span>}
              </span>
            </li>
          ))}
        </ol>
        {error && (
          <p role="alert" className="mt-2 text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
