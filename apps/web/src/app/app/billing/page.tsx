import type { Metadata } from 'next';
import Link from 'next/link';
import {
  cancelSubscription,
  formatMoneyMinor,
  getBillingAnalytics,
  listPackages,
  listSubscriptions,
  recordManualPayment,
  retrySubscriptionPayment,
  savePackage,
} from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Billing | Repsy' };

async function createPackageAction(data: FormData) {
  'use server';
  await withServerTenant((tx, actor) =>
    savePackage(tx, actor, {
      title: String(data.get('title') ?? ''),
      kind: String(data.get('kind') ?? 'one_off'),
      interval:
        String(data.get('kind') ?? '') === 'recurring'
          ? String(data.get('interval') ?? 'month')
          : null,
      amountMinor: Number(data.get('amountMinor') ?? 0),
      currency: String(data.get('currency') ?? 'USD'),
      installments:
        String(data.get('kind') ?? '') === 'payment_plan'
          ? Number(data.get('installments') ?? 3)
          : null,
      trialDays: Number(data.get('trialDays') ?? 0),
    }),
  );
}

async function subscriptionAction(data: FormData) {
  'use server';
  const id = String(data.get('subscriptionId') ?? '');
  const action = String(data.get('action') ?? '');
  await withServerTenant((tx, actor) => {
    if (action === 'cancel') return cancelSubscription(tx, actor, id).then(() => undefined);
    return retrySubscriptionPayment(tx, actor, id).then(() => undefined);
  });
}

async function manualPaymentAction(data: FormData) {
  'use server';
  await withServerTenant((tx, actor) =>
    recordManualPayment(tx, actor, {
      packageId: String(data.get('packageId') ?? ''),
      customerEmail: String(data.get('customerEmail') ?? ''),
      amountMinor: Number(data.get('amountMinor') ?? 0),
      currency: String(data.get('currency') ?? 'USD'),
      method: String(data.get('method') ?? 'cash'),
      reference: String(data.get('reference') ?? ''),
    }),
  );
}

/** PRD K3, K7, K9, K15: packages, subscriptions, revenue and manual payments. */
export default async function BillingPage() {
  const { packages, subscriptions, needsReview, analytics } = await withServerTenant(
    async (tx, actor) => ({
      packages: await listPackages(tx, actor),
      subscriptions: await listSubscriptions(tx, actor),
      needsReview: await listSubscriptions(tx, actor, { needsReview: true }),
      analytics: await getBillingAnalytics(tx, actor),
    }),
  );
  const mrr = analytics.summary.mrrByCurrency
    .map((r) => formatMoneyMinor(r.mrrMinor, r.currency))
    .join(', ');
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Billing</h1>
      <div className="flex flex-col gap-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Monthly recurring revenue', mrr || '–'],
            ['Active subscriptions', String(analytics.summary.activeSubscriptions)],
            [
              'Churn, last 30 days',
              analytics.summary.churnPercent30d === null
                ? '–'
                : `${analytics.summary.churnPercent30d}%`,
            ],
            [
              'Refunded',
              formatMoneyMinor(
                analytics.summary.refundsMinor,
                analytics.summary.revenueByCurrency[0]?.currency ?? 'USD',
              ),
            ],
          ].map(([k, v]) => (
            <div key={k} className="rounded-card bg-surface p-4 shadow-card">
              <dt className="text-sm text-secondary">{k}</dt>
              <dd className="text-3xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-secondary">
          <Link
            href="/api/v1/billing/analytics?format=csv"
            className="text-accent underline underline-offset-4"
          >
            Download revenue CSV
          </Link>
          {' · '}
          <Link
            href="/app/billing/self-service"
            className="text-accent underline underline-offset-4"
          >
            Client billing self-service
          </Link>
          {' · '}
          <Link href="/app/analytics/business" className="text-accent underline underline-offset-4">
            Business analytics
          </Link>
        </p>

        {needsReview.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Needs review</CardTitle>
              <CardDescription>
                Failed payments that ran out of retries. Contact the client before access pauses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {needsReview.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      {s.packageTitle} · {formatMoneyMinor(s.amountMinor, s.currency)}
                    </span>
                    <form action={subscriptionAction}>
                      <input type="hidden" name="subscriptionId" value={s.id} />
                      <input type="hidden" name="action" value="retry" />
                      <button type="submit" className="text-accent underline underline-offset-4">
                        Retry payment (test provider)
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle as="h2">Subscriptions</CardTitle>
            <CardDescription>
              Cancel runs to the end of the current period; the end date is shown at once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-secondary">No subscriptions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Subscriptions</caption>
                  <thead>
                    <tr className="text-secondary">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Package
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Status
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Amount
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Next charge
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Ends
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-1 pr-4">{s.packageTitle}</td>
                        <td className="py-1 pr-4">{s.status}</td>
                        <td className="py-1 pr-4">{formatMoneyMinor(s.amountMinor, s.currency)}</td>
                        <td className="py-1 pr-4">
                          {s.nextChargeAt ? new Date(s.nextChargeAt).toLocaleDateString() : '–'}
                        </td>
                        <td className="py-1 pr-4">
                          {s.endsAt ? new Date(s.endsAt).toLocaleDateString() : '–'}
                        </td>
                        <td className="py-1 pr-4">
                          {s.status !== 'cancelled' && s.status !== 'ended' && (
                            <form action={subscriptionAction}>
                              <input type="hidden" name="subscriptionId" value={s.id} />
                              <input type="hidden" name="action" value="cancel" />
                              <button
                                type="submit"
                                className="text-accent underline underline-offset-4"
                              >
                                Cancel
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Packages</CardTitle>
            <CardDescription>
              What you sell. A package can invite, tag, start an onboarding sequence and assign a
              template on purchase — the sequence itself runs in the journeys slice.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packages.length === 0 ? (
              <p className="text-sm text-secondary">No packages yet. Create one below.</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-2 text-sm">
                {packages.map((p) => (
                  <li key={p.id}>
                    {p.title} · {formatMoneyMinor(p.amountMinor, p.currency)}
                    {p.kind === 'recurring' ? ` per ${p.interval}` : ''}
                    {p.kind === 'payment_plan' ? ` × ${p.installments}` : ''}
                    {p.trialDays > 0 ? ` · ${p.trialDays}-day trial` : ''}
                    {!p.active ? ' · archived' : ''}
                  </li>
                ))}
              </ul>
            )}
            <form action={createPackageAction} className="flex flex-col gap-3">
              <div>
                <label htmlFor="pkg-title" className="block text-sm font-medium">
                  Title
                </label>
                <input
                  id="pkg-title"
                  name="title"
                  required
                  maxLength={120}
                  className="w-full rounded border p-2 text-base"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="pkg-kind" className="block text-sm font-medium">
                    Kind
                  </label>
                  <select id="pkg-kind" name="kind" className="w-full rounded border p-2 text-base">
                    <option value="one_off">One-off</option>
                    <option value="recurring">Recurring</option>
                    <option value="payment_plan">Payment plan</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="pkg-amount" className="block text-sm font-medium">
                    Amount (cents / paise)
                  </label>
                  <input
                    id="pkg-amount"
                    name="amountMinor"
                    type="number"
                    min={0}
                    required
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="pkg-currency" className="block text-sm font-medium">
                    Currency
                  </label>
                  <input
                    id="pkg-currency"
                    name="currency"
                    defaultValue="USD"
                    maxLength={3}
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="pkg-interval" className="block text-sm font-medium">
                    Interval (recurring)
                  </label>
                  <select
                    id="pkg-interval"
                    name="interval"
                    className="w-full rounded border p-2 text-base"
                  >
                    <option value="month">Monthly</option>
                    <option value="week">Weekly</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="pkg-installments" className="block text-sm font-medium">
                    Installments (plan)
                  </label>
                  <input
                    id="pkg-installments"
                    name="installments"
                    type="number"
                    min={2}
                    max={24}
                    defaultValue={3}
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="pkg-trial" className="block text-sm font-medium">
                    Free trial (days)
                  </label>
                  <input
                    id="pkg-trial"
                    name="trialDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={0}
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="self-start rounded bg-accent-fill px-4 py-2 text-on-accent"
              >
                Create package
              </button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Record a manual payment</CardTitle>
            <CardDescription>
              Cash or a bank transfer against a package (K15). No provider is involved, and the
              payment still counts in revenue and gets a branded receipt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={manualPaymentAction} className="flex flex-col gap-3">
              <div>
                <label htmlFor="man-package" className="block text-sm font-medium">
                  Package
                </label>
                <select
                  id="man-package"
                  name="packageId"
                  required
                  className="w-full rounded border p-2 text-base"
                >
                  {packages
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="man-email" className="block text-sm font-medium">
                    Client email
                  </label>
                  <input
                    id="man-email"
                    name="customerEmail"
                    type="email"
                    required
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="man-amount" className="block text-sm font-medium">
                    Amount (cents / paise)
                  </label>
                  <input
                    id="man-amount"
                    name="amountMinor"
                    type="number"
                    min={1}
                    required
                    className="w-full rounded border p-2 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="man-method" className="block text-sm font-medium">
                    Method
                  </label>
                  <select
                    id="man-method"
                    name="method"
                    className="w-full rounded border p-2 text-base"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="man-ref" className="block text-sm font-medium">
                  Reference (optional)
                </label>
                <input
                  id="man-ref"
                  name="reference"
                  maxLength={120}
                  className="w-full rounded border p-2 text-base"
                />
              </div>
              <button
                type="submit"
                className="self-start rounded bg-accent-fill px-4 py-2 text-on-accent"
              >
                Record payment
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
