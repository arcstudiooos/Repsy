'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';

/** Cancel a session, after one confirmation (inside the window the server refuses and says why). */
export function CancelBooking({ id, label = 'Cancel' }: { id: string; label?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    const res = await send('POST', `/api/v1/bookings/${id}/cancel`);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setError(res.message);
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cancel()}>
            Yes, cancel it
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
