'use client';

import { useId, useState, type FormEvent } from 'react';
import type { SessionNoteView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

const MAX = 500;
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** Notes on one exercise in a session (PRD D9): read in order, so a coach's note reads as a reply. */
export function ExerciseNotes({
  sessionId,
  workoutVersionExerciseId,
  exerciseName,
  setCount,
  notes,
  viewer,
  canAdd,
  onAdded,
}: {
  sessionId: string;
  workoutVersionExerciseId: string;
  exerciseName: string;
  setCount: number;
  notes: SessionNoteView[];
  viewer: 'client' | 'coach';
  canAdd: boolean;
  onAdded: (note: SessionNoteView) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [setIndex, setSetIndex] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a note first.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await call<SessionNoteView>(
      'POST',
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/notes`,
      { workoutVersionExerciseId, setIndex: setIndex === '' ? null : Number(setIndex), body },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors?.body?.[0] ?? res.message);
      return;
    }
    onAdded(res.data);
    setBody('');
    setSetIndex('');
    setOpen(false);
    toast.success('Note added.');
  }

  const who = (n: SessionNoteView) =>
    n.authorRole === viewer ? 'You' : n.authorRole === 'coach' ? 'Your coach' : n.authorName;

  return (
    <div className="flex flex-col gap-2">
      {notes.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={`Notes on ${exerciseName}`}>
          {notes.map((n) => (
            <li key={n.id} className="rounded-control bg-canvas px-3 py-2 text-sm">
              <span className="block text-secondary">
                {who(n)}
                {n.setIndex !== null && ` · set ${n.setIndex + 1}`} · {fmtTime(n.createdAt)}
              </span>
              <span className="break-words whitespace-pre-line">{n.body}</span>
            </li>
          ))}
        </ul>
      )}
      {canAdd &&
        (open ? (
          <form
            onSubmit={submit}
            aria-label={`Add a note on ${exerciseName}`}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`${id}-body`} className="text-sm font-medium">
              Note
            </label>
            <textarea
              id={`${id}-body`}
              value={body}
              maxLength={MAX}
              rows={2}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
              className="w-full rounded-control border border-input-border bg-surface p-2 text-base"
            />
            <label htmlFor={`${id}-set`} className="text-sm font-medium">
              About
            </label>
            <select
              id={`${id}-set`}
              value={setIndex}
              onChange={(e) => setSetIndex(e.target.value)}
              className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
            >
              <option value="">The whole exercise</option>
              {Array.from({ length: setCount }, (_, i) => (
                <option key={i} value={i}>
                  Set {i + 1}
                </option>
              ))}
            </select>
            {error && (
              <p id={`${id}-err`} role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Adding…' : 'Add note'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 self-start"
            onClick={() => setOpen(true)}
            aria-label={`Add note on ${exerciseName}`}
          >
            Add note
          </Button>
        ))}
    </div>
  );
}
