import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { formatMoney } from '@kinetic/core/money';
import {
  fakeCheckoutPaidEvents,
  fakeWebhookBody,
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '@kinetic/core';
import { AuthShell } from '@/components/auth-ui';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/states/LoadingState';
import { appOrigin, fakePaymentsEnabled, fakeSecret } from '@/server/payments';

export const metadata: Metadata = {
  title: 'Test checkout | Kinetic',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Only same-origin destinations: the page must never become an open redirect. */
const safe = (url: string) => (url.startsWith(`${appOrigin()}/`) ? url : `${appOrigin()}/`);

async function pay(data: FormData) {
  'use server';
  if (!fakePaymentsEnabled()) notFound();
  const unit = String(data.get('unit') ?? '');
  const events = fakeCheckoutPaidEvents({
    checkoutRef: String(data.get('ref') ?? ''),
    purchaseId: String(data.get('purchase') ?? ''),
    amountMinor: Number(data.get('amount') ?? 0),
    currency: String(data.get('currency') ?? 'USD'),
    mode: data.get('mode') === 'subscription' ? 'subscription' : 'payment',
    ...(unit === 'week' || unit === 'month'
      ? { interval: { unit, count: Number(data.get('count') ?? 1) } }
      : {}),
    trialDays: Number(data.get('trial') ?? 0),
    now: new Date(),
  });
  const body = fakeWebhookBody(String(data.get('account') ?? ''), events);
  const res = await fetch(`${appOrigin()}/api/webhooks/payments/fake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FAKE_SIGNATURE_HEADER]: signFakeWebhook(fakeSecret(), body),
    },
    body,
  });
  if (!res.ok) throw new Error(`Fake webhook failed (${res.status})`);
  redirect(safe(String(data.get('success') ?? '')));
}

async function decline(data: FormData) {
  'use server';
  redirect(safe(String(data.get('cancel') ?? '')));
}

async function Body({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Search>;
}) {
  if (!fakePaymentsEnabled()) notFound();
  const { ref } = await params;
  const q = await searchParams;
  const amount = Number(one(q.amount));
  const currency = one(q.currency) || 'USD';
  const fields = [
    'purchase',
    'account',
    'amount',
    'currency',
    'mode',
    'trial',
    'unit',
    'count',
    'success',
    'cancel',
  ];
  return (
    <AuthShell title="Test checkout">
      <p className="mb-2 text-base">
        This is the development stand-in for a payment provider. No money moves.
      </p>
      <p className="mb-4 text-lg font-semibold">
        {one(q.title)}: {formatMoney(Number.isFinite(amount) ? amount : 0, currency)}
        {Number(one(q.trial)) > 0 && ` after a ${one(q.trial)}-day trial`}
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={pay}>
          <input type="hidden" name="ref" value={ref} />
          {fields.map((f) => (
            <input key={f} type="hidden" name={f} value={one(q[f])} />
          ))}
          <Button type="submit">Pay (test)</Button>
        </form>
        <form action={decline}>
          <input type="hidden" name="cancel" value={one(q.cancel)} />
          <Button type="submit" variant="secondary">
            Cancel
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}

export default function FakeCheckoutPage(props: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Search>;
}) {
  return (
    <Suspense fallback={<LoadingState />}>
      <Body {...props} />
    </Suspense>
  );
}
