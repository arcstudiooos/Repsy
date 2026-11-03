'use client';

import { useState } from 'react';
import type { CheckinHighlight } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';

/**
 * PRD I12 (D-013 #14): on request, a few points on what changed since the previous check-in, each linked to the
 * answers it rests on. Labelled as drafted with AI; shown only here and never stored.
 */
export function CheckinHighlights({ checkinId }: { checkinId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    points: CheckinHighlight[];
    previousId: string | null;
    note: string | null;
  } | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const res = await send<{
      points: CheckinHighlight[];
      previousId: string | null;
      note: string | null;
    }>('POST', `/api/v1/ai/checkins/${checkinId}/highlights`);
    setBusy(false);
    if (res.ok && res.data) setResult(res.data);
    else if (!res.ok) setError(res.message);
  }

  if (!result) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void load()}>
            {busy ? 'Reading…' : 'Highlights (drafted with AI)'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <section aria-label="Highlights" className="rounded-card border border-input-border p-3">
      <p className="mb-2 text-sm font-medium">
        Highlights{' '}
        <span className="font-normal text-secondary">· Drafted with AI, check the answers</span>
      </p>
      {result.points.length === 0 ? (
        <p className="text-sm text-secondary">Nothing stood out.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {result.points.map((p, i) => (
            <li key={i}>
              {p.text}{' '}
              {p.sources.map((s) => {
                const target = s.checkin === 'current' ? checkinId : result.previousId;
                return target ? (
                  <a
                    key={`${s.checkin}-${s.questionId}`}
                    href={`#a-${target}-${s.questionId}`}
                    className="mr-2 text-accent underline underline-offset-2"
                  >
                    {s.checkin === 'previous' ? `Earlier: ${s.label}` : s.label}
                  </a>
                ) : null;
              })}
            </li>
          ))}
        </ul>
      )}
      {result.note && <p className="mt-2 text-sm text-secondary">{result.note}</p>}
    </section>
  );
}
