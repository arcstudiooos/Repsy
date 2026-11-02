'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { formatMoney, minorDigits, parseMoney } from '@kinetic/core/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { firstError, send } from '@/lib/billing-api';

const selectClass =
  'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** PRD K15: record cash, a bank transfer or another offline payment against a package. */
export function RecordPayment({
  clientId,
  currency,
  packages,
  manualPurchases,
}: {
  clientId: string;
  currency: string;
  packages: { id: string; title: string; amountMinor: number }[];
  manualPurchases: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  const [target, setTarget] = useState(
    manualPurchases[0] ? `p:${manualPurchases[0].id}` : packages[0] ? `k:${packages[0].id}` : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const amountText = String(f.get('amount') ?? '').trim();
    const amountMinor = amountText === '' ? undefined : parseMoney(amountText, currency);
    if (amountMinor === null) {
      setError('Enter the amount paid.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await send<{ receiptNo: number }>('POST', '/api/v1/payments/manual', {
      clientId,
      ...(target.startsWith('p:')
        ? { purchaseId: target.slice(2) }
        : { packageId: target.slice(2) }),
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      method: String(f.get('method') ?? 'cash'),
      paidAt: `${String(f.get('paidAt') ?? today)}T12:00:00.000Z`,
      note: String(f.get('note') ?? ''),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Payment recorded');
      form.reset();
      router.refresh();
    } else setError(firstError(res));
  }
  if (packages.length === 0 && manualPurchases.length === 0) {
    return null;
  }
  const f = 'flex flex-col gap-1';
  const pkg = packages.find((p) => `k:${p.id}` === target);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a payment</CardTitle>
        <CardDescription>
          For cash, bank transfers and other payments taken outside the app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div className={`${f} sm:col-span-2`}>
            <label htmlFor={`${id}-for`} className="text-sm font-medium">
              For
            </label>
            <select
              id={`${id}-for`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={selectClass}
            >
              {manualPurchases.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  Next payment: {p.title}
                </option>
              ))}
              {packages.map((p) => (
                <option key={p.id} value={`k:${p.id}`}>
                  New: {p.title} ({formatMoney(p.amountMinor, currency)})
                </option>
              ))}
            </select>
          </div>
          <div className={f}>
            <label htmlFor={`${id}-amount`} className="text-sm font-medium">
              Amount ({currency})
            </label>
            <Input
              id={`${id}-amount`}
              name="amount"
              inputMode="decimal"
              placeholder={
                pkg
                  ? (pkg.amountMinor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency))
                  : 'Package price'
              }
            />
          </div>
          <div className={f}>
            <label htmlFor={`${id}-method`} className="text-sm font-medium">
              Paid by
            </label>
            <select id={`${id}-method`} name="method" defaultValue="cash" className={selectClass}>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className={f}>
            <label htmlFor={`${id}-date`} className="text-sm font-medium">
              Paid on
            </label>
            <Input
              id={`${id}-date`}
              name="paidAt"
              type="date"
              max={today}
              defaultValue={today}
              required
            />
          </div>
          <div className={f}>
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              Reference (optional)
            </label>
            <Input id={`${id}-note`} name="note" maxLength={500} />
          </div>
          {error && (
            <p role="alert" className="text-danger sm:col-span-2">
              {error}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy || target === ''}>
              Record payment
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
