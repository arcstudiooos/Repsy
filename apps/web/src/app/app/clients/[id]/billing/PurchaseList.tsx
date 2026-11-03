'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PurchaseView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { PROVIDER_LABEL, PURCHASE_STATUS_LABEL, formatDay, priceLabel } from '@/lib/billing-format';
import { send } from '@/lib/billing-api';

/** A client's purchases, with the manager's cancel controls (K8) and lifting a payment gate (K7). */
export function PurchaseList({
  purchases,
  manager,
  recorder,
}: {
  purchases: PurchaseView[];
  manager: boolean;
  recorder: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function cancel(p: PurchaseView, now: boolean) {
    setBusy(p.id);
    const res = await send('POST', `/api/v1/purchases/${p.id}/cancel`, { now });
    setBusy(null);
    if (res.ok) {
      toast.success(now ? 'Ended now' : 'Will end at the period end');
      router.refresh();
    } else toast.error(res.message);
  }
  async function lift(p: PurchaseView) {
    setBusy(p.id);
    const res = await send('POST', `/api/v1/purchases/${p.id}/lift-gate`);
    setBusy(null);
    if (res.ok) {
      toast.success('Portal access restored until the next failed payment');
      router.refresh();
    } else toast.error(res.message);
  }
  if (purchases.length === 0) return <p className="text-secondary">No packages bought yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {purchases.map((p) => {
        const live = ['trialing', 'active', 'past_due'].includes(p.status);
        return (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold break-words">{p.packageTitle}</p>
              <p className="text-sm text-secondary">
                {priceLabel(p, p.currency)} · {PROVIDER_LABEL[p.provider] ?? p.provider} ·{' '}
                <span className={p.status === 'past_due' ? 'text-warning' : undefined}>
                  {PURCHASE_STATUS_LABEL[p.status] ?? p.status}
                </span>
                {p.currentPeriodEnd &&
                  live &&
                  ` · next ${p.status === 'trialing' ? 'charge' : 'renewal'} ${formatDay(p.currentPeriodEnd)}`}
                {p.status === 'canceled' &&
                  p.currentPeriodEnd &&
                  ` · ends ${formatDay(p.currentPeriodEnd)}`}
                {p.accessEndsAt && ` · access until ${formatDay(p.accessEndsAt)}`}
                {p.installments !== null && ` · ${p.installmentsPaid} of ${p.installments} paid`}
              </p>
            </div>
            {(manager || recorder) && live && (
              <div className="flex flex-wrap gap-2">
                {recorder && p.status === 'past_due' && !p.gateLifted && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => void lift(p)}
                  >
                    Keep portal open
                  </Button>
                )}
                {manager && p.provider !== 'manual' && p.status !== 'canceled' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => void cancel(p, false)}
                  >
                    Cancel at period end
                  </Button>
                )}
                {manager && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => void cancel(p, true)}
                  >
                    End now
                  </Button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
