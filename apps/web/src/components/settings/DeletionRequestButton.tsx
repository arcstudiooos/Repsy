'use client';

import { useState } from 'react';
import type { DeletionRequestView } from '@kinetic/core';
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
import { call } from '@/lib/checkin-api';

const STATUS: Record<DeletionRequestView['status'], string> = {
  requested: 'Deletion requested. Kinetic will verify it, then delete the data.',
  verified: 'Deletion verified. The data will be deleted shortly.',
  processing: 'Deleting the data now.',
  done: 'The data was deleted.',
  rejected: 'The deletion request was not accepted. Contact support for details.',
};

/**
 * Asks for deletion of a client's data in this workspace (S5-3): the client for themselves (`clientId` omitted), or
 * the owner for a client. Shows the request's state once there is one.
 */
export function DeletionRequestButton({
  clientId,
  current,
}: {
  clientId?: string;
  current: DeletionRequestView | null;
}) {
  const [req, setReq] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const self = clientId === undefined;
  if (req && req.status !== 'rejected') {
    return (
      <p role="status" className="text-sm text-secondary">
        {STATUS[req.status]}
      </p>
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          {self ? 'Request deletion' : 'Request data deletion'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {self ? 'Delete your data in this workspace?' : "Delete this client's data?"}
          </DialogTitle>
          <DialogDescription>
            {self
              ? 'Your coach will be told. Kinetic verifies the request, then deletes your workouts, logged sets, check-ins and messages in this workspace. Other workspaces you belong to are not affected. This cannot be undone.'
              : "Kinetic verifies the request, then deletes the client's workouts, logged sets, check-ins, messages and your notes about them. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const res = await call<DeletionRequestView>(
                'POST',
                '/api/v1/deletion-requests',
                self ? {} : { clientId },
              );
              setBusy(false);
              if (res.ok) setReq(res.data);
              else setError(res.message);
            }}
          >
            Request deletion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
