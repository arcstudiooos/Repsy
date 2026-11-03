'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import type { PaymentSettings } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { firstError, send } from '@/lib/billing-api';

/**
 * A fixed list: `Intl.supportedValuesOf('currency')` differs between the server's Node and the browser, which
 * broke hydration of this form. Every code here is also accepted by the server's check (`isCurrency`).
 */
const CURRENCIES = [
  'AED',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'IDR',
  'ILS',
  'INR',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'USD',
  'ZAR',
];

/** Currency (set once), grace before the payment gate, renewal notice and tax details (D-013 #2, #6, #7, #13). */
export function SettingsForm({ settings }: { settings: PaymentSettings }) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rate = String(f.get('taxRate') ?? '').trim();
    const body = {
      ...(settings.currency ? {} : { currency: String(f.get('currency') ?? '') }),
      graceDays: Number(f.get('graceDays')),
      renewalNoticeDays: Number(f.get('renewalNoticeDays')),
      taxId: String(f.get('taxId') ?? '') || null,
      taxRateBp: rate === '' ? null : Math.round(Number(rate) * 100),
      taxHomeRegion: String(f.get('taxHomeRegion') ?? '') || null,
      stripeTaxEnabled: f.get('stripeTax') === 'on',
    };
    setBusy(true);
    const res = await send('PUT', '/api/v1/billing/settings', body);
    setBusy(false);
    if (res.ok) {
      toast.success('Payment settings saved');
      router.refresh();
    } else toast.error(firstError(res));
  }
  const field = 'flex flex-col gap-1';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment settings</CardTitle>
        <CardDescription>Prices are in one currency, chosen once.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className={field}>
            <label htmlFor={`${id}-currency`} className="text-sm font-medium">
              Currency
            </label>
            {settings.currency ? (
              <p id={`${id}-currency`} className="min-h-11 py-2">
                {settings.currency}
              </p>
            ) : (
              <select
                id={`${id}-currency`}
                name="currency"
                required
                defaultValue=""
                className="block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                <option value="" disabled>
                  Pick a currency
                </option>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className={field}>
            <label htmlFor={`${id}-grace`} className="text-sm font-medium">
              Days before a failed payment pauses portal access (0-30)
            </label>
            <Input
              id={`${id}-grace`}
              name="graceDays"
              type="number"
              min={0}
              max={30}
              defaultValue={settings.graceDays}
              required
            />
          </div>
          <div className={field}>
            <label htmlFor={`${id}-notice`} className="text-sm font-medium">
              Renewal reminder, days before (1-30)
            </label>
            <Input
              id={`${id}-notice`}
              name="renewalNoticeDays"
              type="number"
              min={1}
              max={30}
              defaultValue={settings.renewalNoticeDays}
              required
            />
          </div>
          <div className={field}>
            <label htmlFor={`${id}-taxid`} className="text-sm font-medium">
              Tax number on receipts (optional)
            </label>
            <Input
              id={`${id}-taxid`}
              name="taxId"
              maxLength={40}
              defaultValue={settings.taxId ?? ''}
            />
          </div>
          <div className={field}>
            <label htmlFor={`${id}-rate`} className="text-sm font-medium">
              GST rate included in prices, % (optional)
            </label>
            <Input
              id={`${id}-rate`}
              name="taxRate"
              type="number"
              min={0}
              max={50}
              step={0.01}
              defaultValue={settings.taxRateBp === null ? '' : settings.taxRateBp / 100}
            />
          </div>
          <div className={field}>
            <label htmlFor={`${id}-region`} className="text-sm font-medium">
              Your state for GST (optional)
            </label>
            <Input
              id={`${id}-region`}
              name="taxHomeRegion"
              maxLength={60}
              defaultValue={settings.taxHomeRegion ?? ''}
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              name="stripeTax"
              defaultChecked={settings.stripeTaxEnabled}
              className="size-5"
            />
            Let Stripe calculate tax at checkout (Stripe Tax, set up in your Stripe)
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              Save settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
