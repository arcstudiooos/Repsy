'use client';

import { ExerciseDemo, MediaThumb } from '@/components/workout/ExerciseDemo';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { ExerciseView } from '@kinetic/core';
import { demoUrlOf } from '@kinetic/core/exercise-media';
import { EQUIPMENT, MUSCLE_GROUPS, TRACKING_TYPES } from '@kinetic/core/exercise-options';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AlternativesEditor } from './AlternativesEditor';
import { DemoUpload } from './DemoUpload';
import { SELECT_CLASS, TRACKING_LABEL } from './labels';

const SEARCH_DEBOUNCE_MS = 300;

interface Params {
  q?: string;
  muscleGroup?: string;
  equipment?: string;
  trackingType?: string;
  cursor?: string | null;
}

function hrefFor(pathname: string, params: Params): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.muscleGroup) sp.set('muscleGroup', params.muscleGroup);
  if (params.equipment) sp.set('equipment', params.equipment);
  if (params.trackingType) sp.set('trackingType', params.trackingType);
  if (params.cursor) sp.set('cursor', params.cursor);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function ExerciseLibrary({
  items,
  nextCursor,
  q,
  muscleGroup,
  equipment,
  trackingType,
  hasCursor,
}: {
  items: ExerciseView[];
  nextCursor: string | null;
  q: string;
  muscleGroup: string;
  equipment: string;
  trackingType: string;
  hasCursor: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const lastPushed = useRef(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const filters = { q, muscleGroup, equipment, trackingType };

  // The URL changed from outside (Clear filters, back/forward): resync the input and the
  // debounce baseline. Our own pushes set lastPushed first, so they never trigger this.
  useEffect(() => {
    if (q === lastPushed.current) return;
    lastPushed.current = q;
    setSearch(q);
  }, [q]);

  // Debounced search: update the URL (and so the server-rendered list) 300ms after typing stops.
  useEffect(() => {
    if (search.trim() === lastPushed.current) return;
    timer.current = setTimeout(() => {
      lastPushed.current = search.trim();
      startTransition(() =>
        router.replace(
          hrefFor(pathname, { muscleGroup, equipment, trackingType, q: search.trim() }),
        ),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [search, muscleGroup, equipment, trackingType, pathname, router]);

  // A filter change carries the text currently typed and cancels a pending debounced push, so the
  // two never race and overwrite each other's URL.
  const setFilter = (key: 'muscleGroup' | 'equipment' | 'trackingType', value: string) => {
    clearTimeout(timer.current);
    lastPushed.current = search.trim();
    startTransition(() =>
      router.replace(hrefFor(pathname, { ...filters, q: search.trim(), [key]: value })),
    );
  };

  return (
    <div className={cn('flex flex-col gap-4', pending && 'opacity-70')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Input
          type="search"
          aria-label="Search exercises"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <select
          aria-label="Filter by muscle group"
          value={muscleGroup}
          onChange={(e) => setFilter('muscleGroup', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All muscle groups</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by equipment"
          value={equipment}
          onChange={(e) => setFilter('equipment', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All equipment</option>
          {EQUIPMENT.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by tracking type"
          value={trackingType}
          onChange={(e) => setFilter('trackingType', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All tracking types</option>
          {TRACKING_TYPES.map((t) => (
            <option key={t} value={t}>
              {TRACKING_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No exercises match"
          body="Try a different search or filter, or add your own exercise."
          action={
            <Link href={pathname} className={buttonVariants({ variant: 'secondary' })}>
              Clear filters
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Exercises">
          {items.map((e) => (
            <li key={e.id} className="rounded-card bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <MediaThumb url={demoUrlOf(e)} />
                  <h2 className="text-base font-semibold">{e.name}</h2>
                </div>
                <span className="rounded-control bg-canvas px-2 py-1 text-sm text-secondary">
                  {e.isGlobal ? 'Catalog' : 'Custom'}
                </span>
              </div>
              <p className="mt-1 text-sm text-secondary">
                {[
                  e.muscleGroup,
                  e.equipment,
                  e.movementType,
                  TRACKING_LABEL[e.trackingType],
                  e.unilateral ? 'One side at a time' : null,
                  e.difficulty
                    ? e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {e.secondaryMuscles.length > 0 && (
                <p className="text-sm text-secondary">
                  Also works: {e.secondaryMuscles.join(', ')}
                </p>
              )}
              {e.cues.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm" aria-label={`Cues for ${e.name}`}>
                  {e.cues.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {e.instructions && (
                <details className="mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">
                    How to do it
                  </summary>
                  <p className="text-sm whitespace-pre-line">{e.instructions}</p>
                </details>
              )}
              <ExerciseDemo url={demoUrlOf(e)} name={e.name} />
              {!e.isGlobal && <DemoUpload exercise={e} />}
              <AlternativesEditor exercise={e} />
            </li>
          ))}
        </ul>
      )}

      {(hasCursor || nextCursor) && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {hasCursor ? (
            <Link
              href={hrefFor(pathname, filters)}
              className={buttonVariants({ variant: 'secondary' })}
            >
              First page
            </Link>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Link
              href={hrefFor(pathname, { ...filters, cursor: nextCursor })}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
