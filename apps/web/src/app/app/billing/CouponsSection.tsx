'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { formatMoney, parseMoney } from '@kinetic/core/money';
import type { CouponView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { formatDay } from '@/lib/billing-format';
import { firstError, send } from '@/lib/billing-api';

/** PRD K5: codes that discount the first charge, with an expiry and a use cap. */
export function CouponsSection({ coupons, currency }: { coupons: CouponView[]; currency: string }) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const raw = String(f.get('value') ?? '');
    const value = kind === 'percent' ? Number(raw) : parseMoney(raw, currency);
    const expires = String(f.get('expiresAt') ?? '');
    const max = String(f.get('maxUses') ?? '');
    setBusy(true);
    const res = await send('POST', '/api/v1/coupons', {
      code: String(f.get('code') ?? ''),
      kind,
      value: value ?? 0,
      expiresAt: expires ? `${expires}T23:59:59.000Z` : null,
      maxUses: max ? Number(max) : null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Coupon created');
      form.reset();
      router.refresh();
    } else toast.error(firstError(res));
  }
  async function deactivate(c: CouponView) {
    const res = await send('PUT', `/api/v1/coupons/${c.id}/active`, { active: false });
    if (res.ok) {
      toast.success('Coupon turned off');
      router.refresh();
    } else toast.error(res.message);
  }
  const f = 'flex flex-col gap-1';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coupons</CardTitle>
        <CardDescription>A coupon takes money off the first payment only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
          <div className={f}>
            <label htmlFor={`${id}-code`} className="text-sm font-medium">
              Code
            </label>
            <Input
              id={`${id}-code`}
              name="code"
              required
              minLength={3}
              maxLength={30}
              className="uppercase"
            />
          </div>
          <div className={f}>
            <label htmlFor={`${id}-kind`} className="text-sm font-medium">
              Discount
            </label>
            <div className="flex gap-2">
              <select
                id={`${id}-kind`}
                value={kind}
                onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')}
                className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
              >
                <option value="percent">%</option>
                <option value="fixed">{currency}</option>
              </select>
              <Input name="value" required inputMode="decimal" aria-label="Discount amount" />
            </div>
          </div>
          <div className={f}>
            <label htmlFor={`${id}-exp`} className="text-sm font-medium">
              Expires (optional)
            </label>
            <Input id={`${id}-exp`} name="expiresAt" type="date" />
          </div>
          <div className={f}>
            <label htmlFor={`${id}-max`} className="text-sm font-medium">
              Uses allowed (optional)
            </label>
            <Input id={`${id}-max`} name="maxUses" type="number" min={1} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy}>
              Create coupon
            </Button>
          </div>
        </form>
        {coupons.length > 0 && (
          <ul className="flex flex-col divide-y divide-divider">
            {coupons.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{c.code}</strong> ·{' '}
                  {c.kind === 'percent'
                    ? `${c.value}% off`
                    : `${formatMoney(c.value, currency)} off`}{' '}
                  · used {c.uses}
                  {c.maxUses !== null && ` of ${c.maxUses}`}
                  {c.expiresAt && ` · until ${formatDay(c.expiresAt)}`}
                  {!c.active && ' · off'}
                </span>
                {c.active && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void deactivate(c)}
                    aria-label={`Turn off ${c.code}`}
                  >
                    Turn off
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
