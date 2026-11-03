'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { send } from '@/lib/billing-api';
import { formatDay } from '@/lib/billing-format';

/**
 * PRD K8 (D-013 #8): the client's own controls for one purchase. "Update card" opens the provider's hosted page;
 * cancel ends a subscription at the period end, after one confirmation, and says when at once.
 */
export function PlanActions({
  purchaseId,
  card,
  cancellable,
}: {
  purchaseId: string;
  card: boolean;
  cancellable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function manage() {
    setBusy(true);
    setMessage(null);
    const res = await send<{ url: string | null }>(
      'POST',
      `/api/v1/purchases/${purchaseId}/manage`,
    );
    setBusy(false);
    if (!res.ok) return setMessage(res.message);
    if (!res.data?.url) return setMessage('Ask your coach to update how you pay.');
    // The provider's own page (or, in development, back here).
    window.location.href = res.data.url;
  }

  async function cancel() {
    setBusy(true);
    setMessage(null);
    const res = await send<{ status: string; endsAt: string | null }>(
      'POST',
      `/api/v1/purchases/${purchaseId}/cancel`,
      {},
    );
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return setMessage(res.message);
    setMessage(
      res.data?.status === 'ended' || !res.data?.endsAt
        ? 'Cancelled. It has ended.'
        : `Cancelled. You keep access until ${formatDay(res.data.endsAt)}.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {card && (
          <Button size="sm" disabled={busy} onClick={() => void manage()}>
            Update card
          </Button>
        )}
        {cancellable && !confirming && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>
            Cancel
          </Button>
        )}
        {confirming && (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cancel()}>
              Yes, cancel at the period end
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        )}
      </div>
      <p role="status" className="text-sm text-secondary">
        {message}
      </p>
    </div>
  );
}
