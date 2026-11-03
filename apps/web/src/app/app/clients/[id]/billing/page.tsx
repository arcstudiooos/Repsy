import type { Metadata } from 'next';
import { can, getPaymentSettings, listPackages, listPayments, listPurchases } from '@kinetic/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { PaymentsTable } from '@/components/billing/PaymentsTable';
import { loadClient } from '../data';
import { PurchaseList } from './PurchaseList';
import { RecordPayment } from './RecordPayment';

export const metadata: Metadata = { title: 'Billing | Kinetic' };

/** PRD K3, K7, K8, K15: what this client bought, what they paid, and recording a cash or bank payment. */
export default async function ClientBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const data = await withServerTenant(async (tx, actor) => ({
    manager: can(actor, 'billing:manage'),
    recorder: can(actor, 'billing:record'),
    currency: (await getPaymentSettings(tx, actor)).currency,
    packages: await listPackages(tx, actor),
    purchases: await listPurchases(tx, actor, { clientId: client.id }),
    payments: await listPayments(tx, actor, { clientId: client.id }),
  }));
  const manualPurchases = data.purchases
    .filter((p) => p.provider === 'manual' && ['active', 'past_due'].includes(p.status))
    .map((p) => ({ id: p.id, title: p.packageTitle }));
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Packages</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseList
            purchases={data.purchases}
            manager={data.manager}
            recorder={data.recorder}
          />
        </CardContent>
      </Card>
      {data.recorder && data.currency && client.status !== 'archived' && (
        <RecordPayment
          clientId={client.id}
          currency={data.currency}
          packages={data.packages.map((p) => ({
            id: p.id,
            title: p.title,
            amountMinor: p.amountMinor,
          }))}
          manualPurchases={manualPurchases}
        />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentsTable payments={data.payments} showClient={false} />
        </CardContent>
      </Card>
    </div>
  );
}
