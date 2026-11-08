'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { BroadcastAudience } from '@repsy/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/** Broadcast (PRD H6): one message to everyone or a tag, delivered privately to each client. */
export function BroadcastDialog({ audiences }: { audiences: BroadcastAudience[] }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState(audiences[0]?.key ?? 'all');
  const [body, setBody] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = audiences.find((a) => a.key === audience)?.count ?? 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a message.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await call<{ sent: number }>('POST', '/api/v1/messages/broadcast', {
      audience,
      body,
      idempotencyKey: key,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.fieldErrors?.audience?.[0] ?? res.fieldErrors?.body?.[0] ?? res.message);
      return;
    }
    toast.success(`Sent to ${res.data.sent} ${res.data.sent === 1 ? 'client' : 'clients'}.`);
    setBody('');
    setKey(crypto.randomUUID());
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Broadcast</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} aria-label="Broadcast a message" noValidate>
          <DialogHeader>
            <DialogTitle>Broadcast a message</DialogTitle>
            <DialogDescription>
              Each client gets it as a private message in their own conversation; replies come back
              only to you.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-aud`} className="text-sm font-medium">
                Send to
              </label>
              <select
                id={`${id}-aud`}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-base"
              >
                {audiences.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label} ({a.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-body`} className="text-sm font-medium">
                Message
              </label>
              <textarea
                id={`${id}-body`}
                value={body}
                rows={4}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-err` : undefined}
                className="w-full rounded-control border border-input-border bg-surface p-3 text-base"
              />
            </div>
            {error && (
              <p id={`${id}-err`} role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || count === 0}>
              {busy ? 'Sending…' : `Send to ${count} ${count === 1 ? 'client' : 'clients'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
