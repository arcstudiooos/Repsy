'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SetupChecklist as Checklist } from '@kinetic/core';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { call } from '@/lib/checkin-api';
import { cn } from '@/lib/utils';

async function setHidden(hidden: boolean) {
  return call<{ hidden: boolean }>('PUT', '/api/v1/settings/setup-checklist', { hidden });
}

/** First-week setup steps on the coach dashboard (PRD A5). Steps tick themselves from what exists. */
export function SetupChecklist({
  checklist,
  compact = false,
}: {
  checklist: Checklist;
  /** The dashboard side column: smaller type, step descriptions only for the next step. */
  compact?: boolean;
}) {
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

  const nextId = checklist.steps.find((x) => !x.done)?.id;
  return (
    <Card className={cn(compact ? 'sm:p-5' : 'mb-6')}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className={cn(compact && 'text-base')}>
          Get set up ({checklist.doneCount} of {total} done)
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 text-secondary"
          onClick={() => toggle(true)}
          disabled={busy}
          aria-label={compact ? 'Hide checklist' : undefined}
        >
          {compact ? 'Hide' : 'Hide checklist'}
        </Button>
      </CardHeader>
      <CardContent>
        <div
          className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={checklist.doneCount}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-[var(--k-motion-base)]"
            style={{ width: `${(checklist.doneCount / total) * 100}%` }}
          />
        </div>
        <ol className={cn('flex flex-col', !compact && 'sm:grid sm:grid-cols-2 sm:gap-x-6')}>
          {checklist.steps.map((s) => {
            const isNext = s.id === nextId;
            const showBody = !s.done && (!compact || isNext);
            return (
              <li key={s.id}>
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-control py-2.5',
                    isNext && '-mx-2 bg-accent-soft/60 px-2',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px]',
                      s.done ? 'border-accent bg-accent text-white' : 'border-input-border',
                    )}
                  >
                    {s.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    {s.done ? (
                      <span className={cn('text-secondary line-through', compact && 'text-sm')}>
                        {s.title}
                        <span className="sr-only"> (done)</span>
                      </span>
                    ) : (
                      <Link
                        href={s.href}
                        className={cn(
                          'group inline-flex items-center gap-1 font-medium hover:text-accent-ink hover:underline',
                          compact && 'text-sm',
                        )}
                      >
                        {s.title}
                        {isNext && <ChevronRight aria-hidden className="size-4" />}
                      </Link>
                    )}
                    {showBody && <span className="block text-sm text-secondary">{s.body}</span>}
                  </span>
                </div>
              </li>
            );
          })}
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
