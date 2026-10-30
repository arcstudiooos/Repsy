'use client';

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

/**
 * Shown when a save hits 409, or on load when the draft was based on an older version. Nothing is overwritten
 * silently: "Reload latest" discards the draft after a confirmation; "Keep my draft" rebases it on the newer
 * version, and saving it stays an explicit "Save changes".
 */
export function ConflictNotice({
  versionNo,
  onReloadLatest,
  onKeepDraft,
}: {
  versionNo: number;
  /** Resolves when the reload failed (the page reloads on success). */
  onReloadLatest: () => Promise<void>;
  onKeepDraft: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-card border border-danger bg-surface p-4"
    >
      <p className="min-w-0 flex-1 basis-60 text-sm">
        A newer version (version {versionNo}) was saved. Your draft is kept.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          Reload latest
        </Button>
        <Button type="button" variant="secondary" onClick={onKeepDraft}>
          Keep my draft
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload the latest version?</DialogTitle>
            <DialogDescription>Reloading discards your draft.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onReloadLatest();
                setBusy(false);
                setConfirming(false);
              }}
            >
              {busy ? 'Reloading...' : 'Reload latest'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
