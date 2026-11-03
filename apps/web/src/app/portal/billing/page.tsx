import type { Metadata } from 'next';
import Link from 'next/link';
import { listPayments, listPurchases } from '@kinetic/core';
import { PaymentsTable } from '@/components/billing/PaymentsTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PROVIDER_LABEL, PURCHASE_STATUS_LABEL, formatDay, priceLabel } from '@/lib/billing-format';
import { PlanActions } from '@/portal/billing/PlanActions';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Billing | Kinetic' };

const LIVE = ['trialing', 'active', 'past_due', 'canceled'];

/** PRD K8 (D-013 #8): the client's plans, next charge, receipts, card updates and one-click cancel. */
export default async function PortalBillingPage() {
  const { purchases, payments } = await withPortalTenant(async (tx, actor) => ({
    purchases: await listPurchases(tx, actor),
    payments: await listPayments(tx, actor),
  }));
  const current = purchases.filter((p) => LIVE.includes(p.status));
  const past = purchases.filter((p) => !LIVE.includes(p.status));
  return (
    <>
      <Link
        href="/portal/profile"
        className="mb-4 inline-block text-accent underline underline-offset-4"
      >
        Back to profile
      </Link>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Billing</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Your plans</CardTitle>
          </CardHeader>
          <CardContent>
            {current.length === 0 ? (
              <p className="text-secondary">You have no active plans.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {current.map((p) => {
                  const card = p.provider !== 'manual' && p.kind !== 'one_off';
                  const next =
                    p.status === 'canceled'
                      ? p.currentPeriodEnd && `Ends ${formatDay(p.currentPeriodEnd)}`
                      : p.currentPeriodEnd &&
                        (p.installments === null || p.installmentsPaid < p.installments) &&
                        `Next charge ${formatDay(p.currentPeriodEnd)}`;
                  return (
                    <li key={p.id} className="flex flex-col gap-2 py-3">
                      <div>
                        <p className="font-semibold break-words">{p.packageTitle}</p>
                        <p className="text-sm text-secondary">
                          {priceLabel(p, p.currency)} · {PROVIDER_LABEL[p.provider] ?? p.provider}
                        </p>
                        <p className={p.status === 'past_due' ? 'text-warning' : 'text-secondary'}>
                          {PURCHASE_STATUS_LABEL[p.status] ?? p.status}
                          {next && ` · ${next}`}
                          {p.accessEndsAt && ` · access until ${formatDay(p.accessEndsAt)}`}
                          {p.installments !== null &&
                            ` · ${p.installmentsPaid} of ${p.installments} paid`}
                        </p>
                      </div>
                      <PlanActions
                        purchaseId={p.id}
                        card={card}
                        cancellable={p.status !== 'canceled' && p.kind !== 'one_off'}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {past.length > 0 && (
              <p className="mt-4 text-sm text-secondary">
                Ended: {past.map((p) => p.packageTitle).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Payments and receipts</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentsTable
              payments={payments}
              showClient={false}
              receiptBase="/portal/billing/receipts"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
