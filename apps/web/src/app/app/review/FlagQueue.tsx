'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { FlagFilter, FlagView } from '@kinetic/core';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { createFollowup, patchFlag, type FlagPatch } from '@/lib/review-api';
import { formatDate } from '../clients/StatusBadge';

type Dialogs =
  | { kind: 'resolve' | 'dismiss'; flag: FlagView }
  | { kind: 'snooze'; flag: FlagView }
  | { kind: 'followup'; clientId: string; clientName: string }
  | null;

const SNOOZES = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
];

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** One card per client (S4-3): each flag with its rule, evidence dates and actions. */
export function FlagQueue({
  initial,
  filter,
  todayLocalDate,
}: {
  initial: FlagView[];
  filter: FlagFilter;
  todayLocalDate: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [flags, setFlags] = useState(initial);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (d: Dialogs) => {
    setReason('');
    setUntil('');
    setTitle('');
    setDue('');
    setError(null);
    setDialog(d);
  };

  /** Optimistic: the flag leaves this view at once and comes back if the server refuses. */
  async function act(flag: FlagView, body: FlagPatch, success: string) {
    const before = flags;
    setBusy(true);
    setError(null);
    setFlags((fs) => fs.filter((f) => f.id !== flag.id));
    const res = await patchFlag(flag.id, body);
    setBusy(false);
    if (res.ok) {
      setDialog(null);
      toast.success(success);
      router.refresh();
      return;
    }
    setFlags(before);
    const fieldMessage = Object.values(res.fieldErrors ?? {})[0]?.[0];
    setError(fieldMessage ?? res.message);
    if (!dialog) toast.error(res.message);
  }

  async function addFollowup(clientId: string) {
    setBusy(true);
    setError(null);
    const res = await createFollowup({ clientId, title, ...(due ? { dueLocalDate: due } : {}) });
    setBusy(false);
    if (res.ok) {
      setDialog(null);
      if (filter === 'needs_attention') setFlags((fs) => [...fs, res.data]);
      toast.success('Follow-up added');
      router.refresh();
    } else {
      setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
    }
  }

  const byClient = new Map<string, FlagView[]>();
  for (const f of flags) byClient.set(f.clientId, [...(byClient.get(f.clientId) ?? []), f]);

  // Not an early return: the dialogs must stay mounted while an optimistic removal empties the list.
  const empty =
    flags.length === 0 ? (
      <p className="rounded-card border border-dashed border-input-border/60 bg-surface p-6 text-center text-secondary">
        {filter === 'needs_attention'
          ? 'Nothing needs review right now.'
          : filter === 'snoozed'
            ? 'Nothing is snoozed.'
            : 'Nothing has been closed yet.'}
      </p>
    ) : null;

  const errorText = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  return (
    <>
      {empty}
      <ul className="flex flex-col gap-4" hidden={flags.length === 0}>
        {[...byClient.entries()].map(([clientId, items]) => (
          <li key={clientId}>
            <Card className="border-l-4 border-l-warning-fill">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle as="h3" className="flex items-center gap-3">
                  <Avatar name={items[0]?.clientName ?? ''} />
                  <Link
                    href={`/app/clients/${clientId}`}
                    className="break-words hover:text-accent hover:underline"
                  >
                    {items[0]?.clientName}
                  </Link>
                  <Badge tone="warning">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </Badge>
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/app/clients/${clientId}/messages`}
                    className={buttonVariants({ variant: 'soft', size: 'sm' })}
                  >
                    Send message
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-11"
                    onClick={() =>
                      open({ kind: 'followup', clientId, clientName: items[0]?.clientName ?? '' })
                    }
                  >
                    Create follow-up
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((f) => (
                    <li key={f.id} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-control border border-warning px-2 py-0.5 text-sm font-medium text-warning">
                          Needs review
                        </span>
                        <Link href={f.href} className="font-medium underline underline-offset-4">
                          {f.title ?? f.ruleText}
                        </Link>
                      </div>
                      <p className="text-sm text-secondary">
                        {f.title ? `${f.ruleText}. ` : ''}
                        {f.dates.length > 0 && <>{f.dates.map(formatDate).join(', ')} · </>}
                        Raised {when(f.createdAt)}
                        {f.reopenedAt && <> · Back from snooze</>}
                        {f.snoozedUntil && <> · Snoozed until {when(f.snoozedUntil)}</>}
                        {f.resolvedAt && (
                          <>
                            {' '}
                            · {f.state === 'dismissed' ? 'Dismissed' : 'Resolved'}{' '}
                            {when(f.resolvedAt)}
                            {f.resolutionReason && <>: {f.resolutionReason}</>}
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {f.state === 'resolved' || f.state === 'dismissed' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="min-h-11"
                            disabled={busy}
                            aria-label={`Reopen: ${f.title ?? f.ruleText}, ${f.clientName}`}
                            onClick={() => void act(f, { action: 'reopen' }, 'Reopened')}
                          >
                            Reopen
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              className="min-h-11"
                              aria-label={`Resolve: ${f.title ?? f.ruleText}, ${f.clientName}`}
                              onClick={() => open({ kind: 'resolve', flag: f })}
                            >
                              Resolve
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="min-h-11"
                              aria-label={`Snooze: ${f.title ?? f.ruleText}, ${f.clientName}`}
                              onClick={() => open({ kind: 'snooze', flag: f })}
                            >
                              Snooze
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11"
                              aria-label={`Dismiss: ${f.title ?? f.ruleText}, ${f.clientName}`}
                              onClick={() => open({ kind: 'dismiss', flag: f })}
                            >
                              Dismiss
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={dialog?.kind === 'resolve' || dialog?.kind === 'dismiss'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent>
          {dialog && (dialog.kind === 'resolve' || dialog.kind === 'dismiss') && (
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason.trim()) {
                  setError('Add a reason.');
                  return;
                }
                void act(
                  dialog.flag,
                  { action: dialog.kind, reason },
                  dialog.kind === 'resolve' ? 'Resolved' : 'Dismissed',
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {dialog.kind === 'resolve' ? 'Resolve this item?' : 'Dismiss this item?'}
                </DialogTitle>
                <DialogDescription>
                  {dialog.flag.clientName}: {dialog.flag.title ?? dialog.flag.ruleText}. A reason is
                  required and is kept with the item.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${uid}-reason`} className="text-sm font-medium">
                  Reason
                </label>
                <textarea
                  id={`${uid}-reason`}
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
                />
              </div>
              {errorText}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={busy}>
                  {dialog.kind === 'resolve' ? 'Resolve' : 'Dismiss'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'snooze'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === 'snooze' && (
            <div className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Snooze this item?</DialogTitle>
                <DialogDescription>
                  It comes back to the queue when the snooze ends. Its due date doesn&apos;t change.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                {SNOOZES.map((s) => (
                  <Button
                    key={s.days}
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        dialog.flag,
                        { action: 'snooze', days: s.days },
                        `Snoozed for ${s.label}`,
                      )
                    }
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <form
                className="flex flex-wrap items-end gap-2"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(dialog.flag, { action: 'snooze', until }, 'Snoozed');
                }}
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${uid}-until`} className="text-sm font-medium">
                    Until a date
                  </label>
                  <Input
                    id={`${uid}-until`}
                    type="date"
                    min={todayLocalDate}
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={busy || !until}>
                  Snooze until date
                </Button>
              </form>
              {errorText}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === 'followup'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === 'followup' && (
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void addFollowup(dialog.clientId);
              }}
            >
              <DialogHeader>
                <DialogTitle>Create a follow-up</DialogTitle>
                <DialogDescription>
                  For {dialog.clientName}. It joins your review queue.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${uid}-title`} className="text-sm font-medium">
                  What to follow up on
                </label>
                <Input
                  id={`${uid}-title`}
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${uid}-due`} className="text-sm font-medium">
                  Due date (optional)
                </label>
                <Input
                  id={`${uid}-due`}
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </div>
              {errorText}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={busy}>
                  Add follow-up
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
