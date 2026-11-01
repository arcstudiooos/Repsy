'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { ExtraExerciseOption, SharedWorkout } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/checkin-api';

const MAX = 20;

/** Starts an extra workout (PRD D13): one the coach shares, or a list of exercises the client picks. */
export function ExtraWorkoutStarter({ shared }: { shared: SharedWorkout[] }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ExtraExerciseOption[]>([]);
  const [picked, setPicked] = useState<ExtraExerciseOption[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const text = q.trim();
      if (!text) {
        setResults([]);
        return;
      }
      fetch(`/api/v1/extra-workouts/exercises?q=${encodeURIComponent(text)}`, {
        credentials: 'same-origin',
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data: ExtraExerciseOption[] } | null) => setResults(j?.data ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function start(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setOpenId(null);
    const res = await call<{ sessionId: string }>('POST', '/api/v1/extra-workouts', body);
    if (res.ok) {
      router.push(`/portal/workouts/${res.data.sessionId}`);
      return;
    }
    setBusy(false);
    const open = res.fieldErrors?.sessionId?.[0];
    if (open) setOpenId(open);
    setError(res.fieldErrors?.exerciseIds?.[0] ?? res.fieldErrors?.title?.[0] ?? res.message);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div role="alert" className="rounded-control bg-canvas p-3 ring-1 ring-danger">
          <p>{error}</p>
          {openId && (
            <Link href={`/portal/workouts/${openId}`} className="text-accent underline">
              Continue that workout
            </Link>
          )}
        </div>
      )}

      {shared.length > 0 && (
        <section aria-labelledby={`${id}-shared`} className="flex flex-col gap-3">
          <h2 id={`${id}-shared`} className="text-lg font-semibold">
            From your coach
          </h2>
          <ul className="flex flex-col gap-3">
            {shared.map((w) => (
              <li key={w.workoutVersionId}>
                <Card>
                  <CardHeader className="mb-2">
                    <CardTitle as="h3" className="break-words">
                      {w.title}
                    </CardTitle>
                    <CardDescription>
                      {w.programTitle} · {w.exercises.join(', ')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      type="button"
                      disabled={busy}
                      aria-label={`Start ${w.title} from ${w.programTitle}`}
                      onClick={() => void start({ workoutVersionId: w.workoutVersionId })}
                    >
                      Start
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby={`${id}-own`} className="flex flex-col gap-3">
        <h2 id={`${id}-own`} className="text-lg font-semibold">
          Build your own
        </h2>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-title`} className="text-sm font-medium">
                Name (optional)
              </label>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={120}
                placeholder="Extra workout"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-q`} className="text-sm font-medium">
                Search exercises
              </label>
              <Input
                id={`${id}-q`}
                type="search"
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {results.length > 0 && (
              <ul aria-label="Search results" className="flex flex-col divide-y divide-divider">
                {results.map((r) => {
                  const added = picked.some((p) => p.id === r.id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                      <span className="min-w-0 break-words">
                        {r.name}
                        <span className="block text-sm text-secondary">{r.equipment}</span>
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={added || picked.length >= MAX}
                        aria-label={added ? `Added ${r.name}` : `Add ${r.name}`}
                        onClick={() => setPicked((p) => [...p, r])}
                      >
                        {added ? 'Added' : 'Add'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div>
              <h3 className="mb-1 text-sm font-medium">Your exercises</h3>
              {picked.length === 0 ? (
                <p className="text-sm text-secondary">Search above and add what you did.</p>
              ) : (
                <ol aria-label="Your exercises" className="flex flex-col gap-1">
                  {picked.map((p, i) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-words">
                        {i + 1}. {p.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => setPicked((all) => all.filter((x) => x.id !== p.id))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div>
              <Button
                type="button"
                disabled={busy || picked.length === 0}
                onClick={() =>
                  void start({
                    exerciseIds: picked.map((p) => p.id),
                    ...(title.trim() ? { title: title.trim() } : {}),
                  })
                }
              >
                {busy ? 'Starting...' : 'Start extra workout'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
