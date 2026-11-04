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
import { deletePageCaches, unsyncedBeforeSignOut, wipeDevice } from '@/portal/offline/signOut';

const WIPE_FAILED = "Couldn't clear this device. Try again.";
const SIGN_OUT_FAILED = "Couldn't sign out. Check your connection and try again.";

/**
 * Signs out, and deletes this device's offline portal data with it (PR #2 review C1): cached pages, started workouts
 * and queued writes must not outlive the session on a shared device. Queued writes are sent first; anything still
 * unsynced is deleted only after the user confirms. The portal and coach shells and the invite page all use this.
 * Fails closed (PR #2 re-review N1): if the device can't be cleared, the user stays signed in and sees why; if the
 * unsynced count can't be read, they are asked first.
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
  // 'unsynced': changes not synced yet; 'unknown': the device couldn't be checked.
  const [confirming, setConfirming] = useState<'unsynced' | 'unknown' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await wipeDevice();
    } catch {
      setBusy(false);
      setError(WIPE_FAILED);
      return;
    }
    const res = await authClient.signOut().catch((e: unknown) => ({ error: e }));
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      // The device is already clear; the session isn't ended yet (PR #2 re-review M4).
      setBusy(false);
      setError(SIGN_OUT_FAILED);
      return;
    }
    // A page the service worker was storing as sign-out began: the cookie is gone now, so nothing new is stored.
    await deletePageCaches().catch(() => undefined);
    router.replace(redirectTo);
    router.refresh();
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const unsynced = await unsyncedBeforeSignOut().catch(() => null);
    if (unsynced !== 0) {
      setBusy(false);
      setConfirming(unsynced === null ? 'unknown' : 'unsynced');
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
      {error && (
        <p role="alert" className="px-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out anyway?</DialogTitle>
            <DialogDescription>
              {confirming === 'unknown'
                ? "We couldn't check this device for workout changes that haven't synced. If you sign out now, any that haven't synced are deleted from this device."
                : "You have workout changes that haven't synced yet. If you sign out now, they're deleted from this device."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Stay signed in
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(null);
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
