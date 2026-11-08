'use client';

import { useEffect, useState } from 'react';
import type { PreviousPerformance } from '@repsy/core';
import type { Units } from '@repsy/core/units';
import { fetchClientHistory } from '@/lib/program-api';
import { formatLoggedSet } from '@/lib/session-format';
import { formatDate } from '../../../clients/StatusBadge';

/** One history call covers at most this many exercises (the API limit). */
const CHUNK = 30;

type Loaded =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; data: Record<string, PreviousPerformance> };

/** Client copies only: what the client last logged for each exercise in this program (S3-1). */
export function PerformanceRail({
  clientId,
  clientName,
  exercises,
  units,
}: {
  clientId: string;
  clientName: string;
  exercises: { id: string; name: string }[];
  units: Units;
}) {
  const ids = exercises.map((e) => e.id).join(',');
  const [loaded, setLoaded] = useState<{ key: string; result: Loaded } | null>(null);

  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    const list = ids.split(',');
    const chunks = Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) =>
      list.slice(i * CHUNK, (i + 1) * CHUNK),
    );
    void Promise.all(chunks.map((chunk) => fetchClientHistory(clientId, chunk))).then((calls) => {
      if (cancelled) return;
      const result: Loaded = calls.every((c) => c.ok)
        ? {
            state: 'ready',
            data: Object.assign({}, ...calls.map((c) => (c.ok ? c.data : {}))) as Record<
              string,
              PreviousPerformance
            >,
          }
        : { state: 'error' };
      setLoaded({ key: ids, result });
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, ids]);

  // A stale result (exercise list changed) keeps showing while the new one loads.
  const result = loaded?.result ?? { state: 'loading' };

  return (
    <aside
      aria-labelledby="performance-rail-title"
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <h2 id="performance-rail-title" className="text-lg font-semibold">
        {clientName}&apos;s last performance
      </h2>
      {exercises.length === 0 ? (
        <p className="text-sm text-secondary">Add exercises to see past performance.</p>
      ) : result.state === 'loading' ? (
        <p className="text-sm text-secondary">Loading past performance...</p>
      ) : result.state === 'error' ? (
        <p className="text-sm text-danger">Couldn&apos;t load past performance.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {exercises.map((e) => {
            const perf = result.data[e.id];
            const sets = perf?.sets.flatMap((s) => formatLoggedSet(s, units) ?? []) ?? [];
            return (
              <li key={e.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium break-words">{e.name}</span>
                <span className="text-sm break-words text-secondary">
                  {perf && sets.length > 0
                    ? `Last time · ${formatDate(perf.localDate)}: ${sets.join(', ')}`
                    : 'No logged sets yet.'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
