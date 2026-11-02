'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProviderName } from '@kinetic/core';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { PROVIDER_LABEL, formatDay } from '@/lib/billing-format';
import { send } from '@/lib/billing-api';

/** PRD K1, K2: connect the account payments go into (the coach's own Stripe or Razorpay). */
export function ConnectCard({
  account,
  providers,
}: {
  account: { provider: ProviderName; accountRef: string; connectedAt: string } | null;
  providers: ProviderName[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(method: 'POST' | 'DELETE', path: string, done: string) {
    setBusy(true);
    const res = await send(method, path);
    setBusy(false);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error(res.message);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment account</CardTitle>
        <CardDescription>
          Payments go straight to your own account. Payouts, disputes and tax settings stay there.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {account ? (
          <>
            <p>
              Connected to <strong>{PROVIDER_LABEL[account.provider]}</strong> since{' '}
              {formatDay(account.connectedAt)}.
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void run('DELETE', '/api/v1/billing/account', 'Disconnected')}
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : providers.length === 0 ? (
          <p className="text-secondary">
            No payment provider is set up for this site yet. You can still record cash and bank
            transfers on a client&apos;s Billing tab.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((p) =>
              p === 'fake' ? (
                <Button
                  key={p}
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run('POST', '/api/v1/billing/connect/fake', 'Test payments connected')
                  }
                >
                  Use test payments
                </Button>
              ) : (
                <a key={p} href={`/api/v1/billing/connect/${p}`} className={buttonVariants()}>
                  Connect {PROVIDER_LABEL[p]}
                </a>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
