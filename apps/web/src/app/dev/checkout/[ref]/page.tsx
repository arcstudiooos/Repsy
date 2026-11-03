import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { formatMoney } from '@kinetic/core/money';
import {
  fakeCheckoutDetails,
  fakeCheckoutPaidEvents,
  fakeWebhookBody,
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '@kinetic/core';
import { AuthShell } from '@/components/auth-ui';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/states/LoadingState';
import { appOrigin, fakePaymentsEnabled, fakeSecret } from '@/server/payments';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

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
  // Everything the webhook says comes from the stored purchase, never from the form, so this page can only
  // complete the checkout it was opened for, at its own price (security review F4).
  const found = await fakeCheckoutDetails(String(data.get('ref') ?? ''));
  if (!found) notFound();
  const { p, accountRef } = found;
  const unit = p.package.intervalUnit;
  const events = fakeCheckoutPaidEvents({
    checkoutRef: p.checkoutRef!,
    purchaseId: p.id,
    amountMinor: p.firstChargeMinor,
    currency: p.currency,
    mode: p.package.kind === 'one_off' ? 'payment' : 'subscription',
    ...(unit === 'week' || unit === 'month'
      ? { interval: { unit, count: p.package.intervalCount ?? 1 } }
      : {}),
    trialDays: p.package.trialDays,
    now: new Date(),
  });
  const body = fakeWebhookBody(accountRef, events);
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
          <input type="hidden" name="success" value={one(q.success)} />
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
