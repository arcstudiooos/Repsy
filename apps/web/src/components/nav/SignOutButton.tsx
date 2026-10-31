'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authClient } from '@/lib/auth-client';
import { unsyncedBeforeSignOut, wipeDevice } from '@/portal/offline/signOut';

/**
 * Signs out, and deletes this device's offline portal data with it (PR #2 review C1): cached pages, started workouts
 * and queued writes must not outlive the session on a shared device. Queued writes are sent first; anything still
 * unsynced is deleted only after the user confirms. The portal and coach shells and the invite page all use this.
 */
export function SignOutButton({
  className,
  redirectTo = '/login',
}: {
  className?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function signOut() {
    setBusy(true);
    await wipeDevice().catch(() => undefined);
    await authClient.signOut();
    router.replace(redirectTo);
    router.refresh();
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    const unsynced = await unsyncedBeforeSignOut().catch(() => 0);
    if (unsynced > 0) {
      setBusy(false);
      setConfirming(true);
      return;
    }
    await signOut();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={className ?? 'w-full justify-start px-3 text-secondary'}
        disabled={busy}
        onClick={() => void start()}
      >
        <LogOut aria-hidden className="size-5" />
        Sign out
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out anyway?</DialogTitle>
            <DialogDescription>
              You have workout changes that haven&apos;t synced yet. If you sign out now,
              they&apos;re deleted from this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Stay signed in
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void signOut();
              }}
            >
              Sign out anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
