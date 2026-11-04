'use client';

import { AlarmClock, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { patchFlag } from '@/lib/review-api';

const SNOOZES = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
];

/**
 * Snooze and Resolve on a dashboard "Needs attention" row, with the same rules as the review queue (D-008 #11):
 * snooze for 1 day, 3 days or a week; resolving needs a reason.
 */
export function FlagActions({ id, what }: { id: string; what: string }) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function snooze(days: number, label: string) {
    const res = await patchFlag(id, { action: 'snooze', days });
    if (!res.ok) return toast.error(res.message);
    toast.success(`Snoozed for ${label}.`);
    router.refresh();
  }

  async function resolve() {
    if (!reason.trim()) {
      setError('Say why it is resolved.');
      return;
    }
    setBusy(true);
    const res = await patchFlag(id, { action: 'resolve', reason: reason.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setOpen(false);
    toast.success('Resolved.');
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Snooze: ${what}`}>
            <AlarmClock aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Snooze for</DropdownMenuLabel>
          {SNOOZES.map((s) => (
            <DropdownMenuItem key={s.days} onSelect={() => void snooze(s.days, s.label)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Resolve: ${what}`}>
            <Check aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve this item?</DialogTitle>
            <DialogDescription>{what}. A reason is kept with the review history.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className="text-sm font-medium">
              Reason
            </label>
            <textarea
              id={reasonId}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${reasonId}-e` : undefined}
              className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
            />
            {error && (
              <p id={`${reasonId}-e`} role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void resolve()} disabled={busy}>
              {busy ? 'Resolving…' : 'Resolve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
