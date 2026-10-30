'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';

interface ApiError {
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export function NewProgramDialog() {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTitleError(null);
    setFormError(null);
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    if (title.length < 1 || title.length > 120) {
      setTitleError('Use 1-120 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/programs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const created = (await res.json()) as { data: { id: string } };
        router.push(`/app/programs/${created.data.id}/edit`);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
      const fieldTitle = body?.error?.fieldErrors?.title?.[0];
      if (fieldTitle) setTitleError(fieldTitle);
      else setFormError(body?.error?.message ?? 'Could not create the program. Try again.');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const titleId = `${uid}-title`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTitleError(null);
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New program</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>
            Name it now. You add weeks, days and exercises next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={titleId} className="text-sm font-medium">
              Title
            </label>
            <Input
              id={titleId}
              name="title"
              required
              maxLength={120}
              autoComplete="off"
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${titleId}-error` : undefined}
            />
            {titleError && (
              <p id={`${titleId}-error`} className="text-sm text-danger">
                {titleError}
              </p>
            )}
          </div>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create program'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
