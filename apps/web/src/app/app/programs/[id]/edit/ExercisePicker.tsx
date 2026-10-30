'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExerciseView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TRACKING_LABEL } from '../../../exercises/labels';

const DEBOUNCE_MS = 250;

interface Page {
  items: ExerciseView[];
  nextCursor: string | null;
}

async function fetchPage(q: string, cursor: string | null, signal: AbortSignal): Promise<Page> {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (cursor) sp.set('cursor', cursor);
  const qs = sp.toString();
  const res = await fetch(`/api/v1/exercises${qs ? `?${qs}` : ''}`, {
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) throw new Error('request failed');
  const body = (await res.json()) as {
    data: ExerciseView[];
    meta?: { nextCursor?: string | null };
  };
  return { items: body.data, nextCursor: body.meta?.nextCursor ?? null };
}

function PickerBody({ onPick }: { onPick: (exercise: ExerciseView) => void }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ExerciseView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Aborted when the query changes: any response for an older query (first page or "Load more") is ignored. */
  const current = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    current.current = ctrl;
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError(false);
        fetchPage(search.trim(), null, ctrl.signal).then(
          (page) => {
            if (ctrl.signal.aborted) return;
            setItems(page.items);
            setNextCursor(page.nextCursor);
            setLoading(false);
          },
          () => {
            if (ctrl.signal.aborted) return;
            setError(true);
            setLoading(false);
          },
        );
      },
      search === '' && attempt === 0 ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [search, attempt]);

  const loadMore = useCallback(async () => {
    const ctrl = current.current;
    if (!nextCursor || !ctrl) return;
    setLoading(true);
    try {
      const page = await fetchPage(search.trim(), nextCursor, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoading(false);
    } catch {
      if (ctrl.signal.aborted) return;
      setError(true);
      setLoading(false);
    }
  }, [nextCursor, search]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        aria-label="Search exercises"
        placeholder="Search by name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoComplete="off"
      />
      <div aria-live="polite" className="text-sm text-secondary">
        {loading
          ? 'Loading exercises...'
          : items.length === 0 && !error
            ? 'No exercises match.'
            : ''}
      </div>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          Could not load exercises.
          <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </Button>
        </div>
      )}
      <ul
        aria-label="Exercise results"
        className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto"
      >
        {items.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-divider p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium">{e.name}</p>
              <p className="text-sm text-secondary">
                {[e.muscleGroup, e.equipment, TRACKING_LABEL[e.trackingType]].join(' · ')}
              </p>
              {e.mediaUrl?.startsWith('https://') && (
                <a
                  href={e.mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline"
                >
                  Demo link<span className="sr-only"> for {e.name} (opens in a new tab)</span>
                </a>
              )}
            </div>
            <Button size="sm" aria-label={`Add ${e.name}`} onClick={() => onPick(e)}>
              Add
            </Button>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <Button variant="secondary" onClick={loadMore} disabled={loading}>
          Load more
        </Button>
      )}
    </div>
  );
}

export function ExercisePicker({ onPick }: { onPick: (exercise: ExerciseView) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Add exercise</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add exercise</DialogTitle>
          <DialogDescription>Search the catalog and your own exercises.</DialogDescription>
        </DialogHeader>
        <PickerBody
          onPick={(e) => {
            onPick(e);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
