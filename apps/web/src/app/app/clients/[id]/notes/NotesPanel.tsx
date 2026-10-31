'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Lock } from 'lucide-react';
import type { NoteView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { addNote, editNote, removeNote } from '@/lib/note-api';

const MAX = 4000;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function NoteForm({
  label,
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  submitLabel: string;
  onSave(body: string): Promise<string | null>;
  onCancel?(): void;
}) {
  const id = useId();
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) {
          setError('Write a note.');
          return;
        }
        setBusy(true);
        const err = await onSave(body);
        setBusy(false);
        setError(err);
        if (!err && !onCancel) setBody('');
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Private notes about a client (S4-5): never shown to the client. Only the author edits or deletes. */
export function NotesPanel({ clientId, notes }: { clientId: string; notes: NoteView[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);

  const saveNew = async (body: string) => {
    const res = await addNote(clientId, body);
    if (!res.ok) return res.fieldErrors?.body?.[0] ?? res.message;
    toast.success('Note added');
    router.refresh();
    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="flex items-center gap-2 text-secondary">
        <Lock aria-hidden className="size-4" />
        Private to coaches in your workspace. The client never sees notes.
      </p>
      <NoteForm label="New note" initial="" submitLabel="Add note" onSave={saveNew} />
      {notes.length === 0 ? (
        <p className="text-secondary">No notes yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-card border border-dashed border-input-border bg-surface p-4"
            >
              {editing === n.id ? (
                <NoteForm
                  label="Edit note"
                  initial={n.body}
                  submitLabel="Save note"
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    const res = await editNote(n.id, body);
                    if (!res.ok) return res.fieldErrors?.body?.[0] ?? res.message;
                    setEditing(null);
                    toast.success('Note saved');
                    router.refresh();
                    return null;
                  }}
                />
              ) : (
                <>
                  <p className="break-words whitespace-pre-line">{n.body}</p>
                  <p className="mt-2 text-xs text-secondary">
                    {n.authorName} · <time dateTime={n.createdAt}>{when(n.createdAt)}</time>
                    {n.updatedAt !== n.createdAt && ' · edited'}
                  </p>
                  {n.mine && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="min-h-11"
                        aria-label={`Edit note from ${when(n.createdAt)}`}
                        onClick={() => setEditing(n.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        aria-label={`Delete note from ${when(n.createdAt)}`}
                        onClick={async () => {
                          const res = await removeNote(n.id);
                          if (res.ok) {
                            toast.success('Note deleted');
                            router.refresh();
                          } else {
                            toast.error(res.message);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
