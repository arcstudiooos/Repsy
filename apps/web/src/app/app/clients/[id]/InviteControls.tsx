'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ClientView } from '@kinetic/core';
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
import { revokeInvite, sendInvite } from '@/lib/invite-api';

/** Rendered in the viewer's locale; the server render may differ, hence suppressHydrationWarning. */
function LocalDate({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })}
    </time>
  );
}

export function InviteControls({
  clientId,
  inviteStatus,
  inviteExpiresAt,
}: Pick<ClientView, 'inviteStatus' | 'inviteExpiresAt'> & { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => ReturnType<typeof sendInvite>, success: string) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      toast.success(success);
      router.refresh();
    } else {
      setConfirming(false);
      setError(result.message);
      toast.error(result.message);
    }
  }

  const send = () => run(() => sendInvite(clientId), 'Invite sent');
  const revoke = () => run(() => revokeInvite(clientId), 'Invite revoked');

  return (
    <div className="flex flex-col gap-3">
      {inviteStatus === 'none' && <p>Not invited yet</p>}
      {inviteStatus === 'pending' && (
        <p>
          Invite sent · expires {inviteExpiresAt ? <LocalDate iso={inviteExpiresAt} /> : 'soon'}
        </p>
      )}
      {inviteStatus === 'expired' && <p>Invite expired</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {inviteStatus === 'none' ? (
          <Button onClick={send} disabled={busy}>
            Send invite
          </Button>
        ) : (
          <Button variant="secondary" onClick={send} disabled={busy}>
            Resend invite
          </Button>
        )}
        {inviteStatus === 'pending' && (
          <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
            Revoke invite
          </Button>
        )}
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this invite?</DialogTitle>
            <DialogDescription>The link in their email will stop working.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" variant="danger" onClick={revoke} disabled={busy}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
