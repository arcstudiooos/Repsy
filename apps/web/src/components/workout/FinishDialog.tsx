'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { SessionDetail } from '@kinetic/core';
import { finishWorkout } from '@/lib/workout-api';

const COPY = {
  complete: {
    trigger: 'Complete workout',
    title: 'Complete workout?',
    body: 'Your logged sets are sent to your coach.',
    confirm: 'Complete',
  },
  skip: {
    trigger: 'Skip workout',
    title: 'Skip this workout?',
    body: 'Your coach will see that this workout was skipped.',
    confirm: 'Skip workout',
  },
} as const;

/**
 * Complete or skip, with an optional comment. The idempotency key is made once per opening and reused on every
 * retry, so a double tap or a retried request finishes the session once (Review Focus #2).
 */
export function FinishDialog({
  kind,
  sessionId,
  disabled,
  onDone,
}: {
  kind: 'complete' | 'skip';
  sessionId: string;
  disabled?: boolean;
  onDone(detail: SessionDetail): void;
}) {
  const copy = COPY[kind];
  const commentId = useId();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await finishWorkout(sessionId, kind, {
      idempotencyKey: key,
      ...(comment.trim() ? { comment } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onDone(res.data);
    } else {
      setError(res.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setKey(crypto.randomUUID());
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={kind === 'complete' ? 'default' : 'secondary'}
          className="min-h-12 flex-1"
          disabled={disabled}
        >
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label htmlFor={commentId} className="text-sm font-medium">
            Comment (optional)
          </label>
          <textarea
            id={commentId}
            maxLength={1000}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
          />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? 'Saving…' : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
