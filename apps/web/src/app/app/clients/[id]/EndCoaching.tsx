'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { CHURN_LABEL, CHURN_REASONS, type ChurnReason } from '@repsy/core/churn';
import type { ClientView } from '@repsy/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';

/**
 * PRD I7: ends coaching (archives the client) with a reason from a short list, which feeds business analytics; an
 * archived client can be restored. History is kept either way.
 */
export function EndCoaching({ client }: { client: Pick<ClientView, 'id' | 'name' | 'status'> }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ChurnReason | ''>('');
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await call('PATCH', `/api/v1/clients/${client.id}`, body);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setOpen(false);
    toast.success(done);
    router.refresh();
  }

  if (client.status === 'archived') {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void patch({ status: 'active' }, `${client.name} restored`)}
      >
        Restore client
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        End coaching
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End coaching for {client.name}?</DialogTitle>
            <DialogDescription>
              They move to Alumni and lose access to the portal. Their history stays, and you can
              restore them later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              Why is coaching ending? (optional)
            </label>
            <select
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value as ChurnReason | '')}
              className="block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
            >
              <option value="">Prefer not to say</option>
              {CHURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {CHURN_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() =>
                void patch(
                  { status: 'archived', churnReason: reason || null },
                  `Coaching ended for ${client.name}`,
                )
              }
            >
              End coaching
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
