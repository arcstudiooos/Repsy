'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import type { ExerciseMatch, WeekInput } from '@repsy/core';
import {
  parseProgram,
  type ImportUnits,
  type ParsedLine,
  type ParsedProgram,
} from '@repsy/core/program-text';
import { toDisplay } from '@repsy/core/units';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/checkin-api';

const REQUIRED: Record<string, 'reps' | 'durationSec' | 'distanceM'> = {
  reps_load: 'reps',
  duration: 'durationSec',
  distance: 'distanceM',
};
const REQUIRED_TEXT = {
  reps: 'reps (like 3x8)',
  durationSec: 'a time (like 3x45s)',
  distanceM: 'a distance (like 1x5km)',
};

function describeSets(line: ParsedLine, units: ImportUnits): string {
  const s = line.sets[0];
  if (!s) return '';
  const n = line.sets.length;
  const parts = [
    s.reps !== undefined ? `${n} × ${s.reps}` : null,
    s.durationSec !== undefined ? `${n} × ${s.durationSec} s` : null,
    s.distanceM !== undefined ? `${n} × ${s.distanceM} m` : null,
    s.loadKg !== undefined ? `@ ${toDisplay(s.loadKg, units)} ${units}` : null,
    s.rpe !== undefined ? `RPE ${s.rpe}` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

export function ImportProgram({ defaultUnits }: { defaultUnits: ImportUnits }) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [units, setUnits] = useState<ImportUnits>(defaultUnits);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedProgram | null>(null);
  const [matches, setMatches] = useState<Record<string, ExerciseMatch>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function read() {
    setError(null);
    setParsed(null);
    const p = parseProgram(text, units);
    if (p.errors.length) {
      setError(p.errors.join(' '));
      return;
    }
    const names = [
      ...new Set(
        p.weeks.flatMap((w) =>
          w.days.flatMap((d) => d.lines.filter((l) => !l.error).map((l) => l.name)),
        ),
      ),
    ];
    setBusy(true);
    const res = await call<ExerciseMatch[]>('POST', '/api/v1/programs/import/match', { names });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMatches(Object.fromEntries(res.data.map((m) => [m.name, m])));
    setChoice(Object.fromEntries(res.data.map((m) => [m.name, m.exerciseId ?? ''])));
    setParsed(p);
  }

  /** Why a readable line still can't be saved with the chosen exercise; null when it can. */
  const lineProblem = (l: ParsedLine): string | null => {
    if (l.error) return l.error;
    const picked = choice[l.name];
    if (!picked) return 'Pick an exercise, or it is left out.';
    const tracking = matches[l.name]?.candidates.find((c) => c.id === picked)?.trackingType;
    const need = tracking ? REQUIRED[tracking] : undefined;
    if (need && l.sets.some((s) => s[need] === undefined)) {
      return `This exercise needs ${REQUIRED_TEXT[need]}.`;
    }
    return null;
  };

  const weeks: WeekInput[] = useMemo(() => {
    if (!parsed) return [];
    return parsed.weeks
      .map((w) => ({
        days: w.days
          .map((d) => ({
            title: d.title,
            exercises: d.lines
              .filter((l) => lineProblem(l) === null)
              .map((l) => ({
                exerciseId: choice[l.name]!,
                ...(l.note ? { note: l.note } : {}),
                ...(l.section ? { section: l.section } : {}),
                sets: l.sets.map((s) => ({ ...s })),
              })),
          }))
          .filter((d) => d.exercises.length > 0),
      }))
      .filter((w) => w.days.length > 0);
    // lineProblem reads choice and matches, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, choice, matches]);
  const kept = weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
  const total =
    parsed?.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.lines.length, 0), 0) ?? 0;

  async function create() {
    setBusy(true);
    setError(null);
    const res = await call<{ id: string }>('POST', '/api/v1/programs/import', {
      title: title.trim(),
      weeks,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors?.title?.[0] ?? res.fieldErrors?.weeks?.[0] ?? res.message);
      return;
    }
    router.push(`/app/programs/${res.data.id}/edit`);
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={`${id}-src`}
        className="rounded-card bg-surface p-4 shadow-card md:p-6"
      >
        <h2 id={`${id}-src`} className="mb-4 text-lg font-semibold">
          Your program
        </h2>
        <div className="mb-4 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-title`} className="text-sm font-medium">
              Program title
            </label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-units`} className="text-sm font-medium">
              Loads without a unit are in
            </label>
            <select
              id={`${id}-units`}
              value={units}
              onChange={(e) => {
                setUnits(e.target.value as ImportUnits);
                setParsed(null);
              }}
              className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </div>
        </div>
        <label htmlFor={`${id}-text`} className="mb-1 block text-sm font-medium">
          Paste the program
        </label>
        <textarea
          id={`${id}-text`}
          value={text}
          rows={12}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setParsed(null);
          }}
          placeholder={
            'Week 1\nDay 1: Upper\nBench press 3x8 @ 60kg\nPull-up 3x6\n\nDay 2: Lower\nBack squat 5x5 @ 100kg\nPlank 3x45s'
          }
          className="w-full rounded-control border border-input-border bg-surface p-3 font-mono text-sm"
        />
        <p className="mt-2 text-sm text-secondary">
          A spreadsheet works too: paste its rows with a header (Week, Day, Exercise, Sets, Reps,
          Load, RPE, Notes).{' '}
          <a href="/templates/repsy-program.csv" download className="text-accent underline">
            Download a sheet template
          </a>
          , or{' '}
          <Link href="/app/support?topic=migration" className="text-accent underline">
            ask us to move your programs for you
          </Link>
          .
        </p>
        {error && (
          <p role="alert" className="mt-2 text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={read} disabled={busy || text.trim() === ''}>
            {busy && !parsed ? 'Reading…' : 'Read program'}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/app/programs">Cancel</Link>
          </Button>
        </div>
      </section>

      {parsed && (
        <section aria-labelledby={`${id}-review`} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id={`${id}-review`} className="text-lg font-semibold">
              Check the exercises
            </h2>
            <Button onClick={create} disabled={busy || kept === 0 || title.trim() === ''}>
              {busy ? 'Creating…' : `Create program (${kept} of ${total} exercises)`}
            </Button>
          </div>
          {title.trim() === '' && (
            <p className="text-sm text-secondary">Add a program title to create it.</p>
          )}
          {parsed.weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-3">
              {parsed.weeks.length > 1 && <h3 className="font-semibold">Week {wi + 1}</h3>}
              {w.days.map((d, di) => (
                <div key={di} className="rounded-card bg-surface p-4 shadow-card">
                  <h4 className="mb-2 font-medium">{d.title}</h4>
                  <ul className="flex flex-col divide-y divide-divider">
                    {d.lines.map((l) => {
                      const problem = lineProblem(l);
                      const m = matches[l.name];
                      const selectId = `${id}-ex-${wi}-${di}-${l.line}`;
                      return (
                        <li key={l.line} className="grid gap-2 py-3 sm:grid-cols-2 sm:items-center">
                          <div className="min-w-0">
                            <p className="font-mono text-sm break-words">{l.raw}</p>
                            {!l.error && (
                              <p className="text-sm text-secondary">{describeSets(l, units)}</p>
                            )}
                          </div>
                          <div className="min-w-0">
                            {!l.error && m && (
                              <>
                                <label htmlFor={selectId} className="sr-only">
                                  Exercise for line {l.line}: {l.name}
                                </label>
                                <select
                                  id={selectId}
                                  value={choice[l.name] ?? ''}
                                  onChange={(e) =>
                                    setChoice((c) => ({ ...c, [l.name]: e.target.value }))
                                  }
                                  className="min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base"
                                >
                                  <option value="">Leave out</option>
                                  {m.candidates.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                {m.candidates.length === 0 && (
                                  <p className="mt-1 text-sm text-secondary">
                                    No match in your library. Add it on the Exercises page, then
                                    read again.
                                  </p>
                                )}
                              </>
                            )}
                            {problem && (
                              <p
                                className={`mt-1 text-sm ${l.error ? 'text-danger' : 'text-secondary'}`}
                              >
                                Line {l.line}: {problem}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
