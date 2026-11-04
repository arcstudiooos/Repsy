import type { Metadata } from 'next';
import { cancelSubscription, formatMoneyMinor, getBillingSelfService } from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'My billing | Repsy' };

async function cancelAction(data: FormData) {
  'use server';
  await withServerTenant((tx, actor) =>
    cancelSubscription(tx, actor, String(data.get('subscriptionId') ?? '')),
  );
}

/**
 * PRD K8: client billing self-service — plan, next charge, receipts, update
 * the card, cancel in one click with the end date shown at once. The card
 * update goes to the provider portal (a test portal link from the fake
 * provider); no real payment form is ever rendered here. A client only ever
 * sees their own subscription and receipts (core scopes by their client row).
 */
export default async function SelfServicePage() {
  const view = await withServerTenant((tx, actor) => getBillingSelfService(tx, actor));
  const sub = view.subscription;
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">My billing</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">My plan</CardTitle>
            <CardDescription>What you are paying for, and what happens next.</CardDescription>
          </CardHeader>
          <CardContent>
            {!sub ? (
              <p className="text-sm text-secondary">
                You have no active plan. Ask your coach about packages.
              </p>
            ) : (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-secondary">Plan</dt>
                  <dd className="text-base font-medium">{sub.packageTitle}</dd>
                </div>
                <div>
                  <dt className="text-secondary">Status</dt>
                  <dd className="text-base">{sub.status}</dd>
                </div>
                <div>
                  <dt className="text-secondary">Amount</dt>
                  <dd className="text-base">
                    {formatMoneyMinor(sub.amountMinor, sub.currency)}
                    {sub.interval === 'week' ? ' per week' : ''}
                    {sub.interval === 'month' ? ' per month' : ''}
                    {sub.installments
                      ? ` · installment ${sub.installmentsPaid} of ${sub.installments}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-secondary">Next charge</dt>
                  <dd className="text-base">
                    {sub.nextChargeAt ? new Date(sub.nextChargeAt).toLocaleDateString() : '–'}
                  </dd>
                </div>
                {sub.trialEndsAt && (
                  <div>
                    <dt className="text-secondary">Free trial ends</dt>
                    <dd className="text-base">{new Date(sub.trialEndsAt).toLocaleDateString()}</dd>
                  </div>
                )}
                {sub.endsAt && (
                  <div>
                    <dt className="text-secondary">Your plan ends</dt>
                    <dd className="text-base font-medium">
                      {new Date(sub.endsAt).toLocaleDateString()}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <div className="mt-4 flex flex-wrap gap-4">
              {view.portalUrl && (
                <a href={view.portalUrl} className="text-accent underline underline-offset-4">
                  Update card (test provider portal)
                </a>
              )}
              {sub && sub.status !== 'cancelled' && sub.status !== 'ended' && (
                <form action={cancelAction}>
                  <input type="hidden" name="subscriptionId" value={sub.id} />
                  <button type="submit" className="text-accent underline underline-offset-4">
                    Cancel my plan
                  </button>
                </form>
              )}
            </div>
            {sub && sub.status !== 'cancelled' && sub.status !== 'ended' && (
              <p className="mt-2 text-sm text-secondary">
                Cancelling runs your plan to the end of its current period — the end date shows here
                at once — and you are not charged again.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Receipts</CardTitle>
            <CardDescription>Branded receipts for every payment, with tax shown.</CardDescription>
          </CardHeader>
          <CardContent>
            {view.receipts.length === 0 ? (
              <p className="text-sm text-secondary">No receipts yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Receipts</caption>
                  <thead>
                    <tr className="text-secondary">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Receipt
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        What for
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Amount
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Tax
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.receipts.map((r) => (
                      <tr key={r.id}>
                        <td className="py-1 pr-4">{r.number}</td>
                        <td className="py-1 pr-4">{r.description}</td>
                        <td className="py-1 pr-4">{formatMoneyMinor(r.amountMinor, r.currency)}</td>
                        <td className="py-1 pr-4">{formatMoneyMinor(r.taxMinor, r.currency)}</td>
                        <td className="py-1 pr-4">{new Date(r.issuedAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
