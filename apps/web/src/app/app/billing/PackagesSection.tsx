'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { parseMoney, minorDigits } from '@kinetic/core/money';
import type { PackageView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { priceLabel, trialLabel } from '@/lib/billing-format';
import { firstError, send } from '@/lib/billing-api';

interface Option {
  id: string;
  name?: string;
  title?: string;
}

const selectClass =
  'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

function PackageForm({
  pkg,
  currency,
  tags,
  templates,
  onDone,
}: {
  pkg: PackageView | null;
  currency: string;
  tags: Option[];
  templates: Option[];
  onDone(): void;
}) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState(pkg?.kind ?? 'one_off');
  const [credits, setCredits] = useState(
    pkg?.sessionCredits !== null && pkg?.sessionCredits !== undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = minorDigits(currency);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amountMinor = parseMoney(String(f.get('amount') ?? ''), currency);
    if (amountMinor === null) {
      setError('Enter the price.');
      return;
    }
    const num = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : Number(v);
    };
    const body = {
      title: String(f.get('title') ?? ''),
      description: String(f.get('description') ?? ''),
      kind,
      amountMinor,
      intervalUnit: kind === 'one_off' ? null : String(f.get('intervalUnit') ?? 'month'),
      intervalCount: kind === 'one_off' ? null : (num('intervalCount') ?? 1),
      installments: kind === 'plan' ? num('installments') : null,
      trialDays: kind === 'one_off' ? 0 : (num('trialDays') ?? 0),
      accessDays: kind === 'one_off' ? num('accessDays') : null,
      public: f.get('public') === 'on',
      tagId: String(f.get('tagId') ?? '') || null,
      templateProgramId: String(f.get('templateProgramId') ?? '') || null,
      sessionCredits: credits ? num('sessionCredits') : null,
      creditsValidDays: credits ? num('creditsValidDays') : null,
    };
    setBusy(true);
    const res = pkg
      ? await send('PUT', `/api/v1/packages/${pkg.id}`, body)
      : await send('POST', '/api/v1/packages', body);
    setBusy(false);
    if (res.ok) {
      toast.success(pkg ? 'Package saved' : 'Package created');
      onDone();
      router.refresh();
    } else setError(firstError(res));
  }
  const amount = pkg ? (pkg.amountMinor / 10 ** digits).toFixed(digits) : '';
  const f = 'flex flex-col gap-1';
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className={`${f} sm:col-span-2`}>
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Name
        </label>
        <Input id={`${id}-title`} name="title" required maxLength={120} defaultValue={pkg?.title} />
      </div>
      <div className={`${f} sm:col-span-2`}>
        <label htmlFor={`${id}-desc`} className="text-sm font-medium">
          What&apos;s included (optional)
        </label>
        <textarea
          id={`${id}-desc`}
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={pkg?.description}
          className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
        />
      </div>
      <fieldset className={`${f} sm:col-span-2`}>
        <legend className="mb-1 text-sm font-medium">How it&apos;s paid</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ['one_off', 'Once'],
              ['recurring', 'Recurring'],
              ['plan', 'Payment plan'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="kind"
                value={v}
                checked={kind === v}
                onChange={() => setKind(v)}
                className="size-5"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={f}>
        <label htmlFor={`${id}-amount`} className="text-sm font-medium">
          {kind === 'plan' ? 'Each payment' : 'Price'} ({currency})
        </label>
        <Input
          id={`${id}-amount`}
          name="amount"
          inputMode="decimal"
          required
          defaultValue={amount}
        />
      </div>
      {kind === 'one_off' ? (
        <div className={f}>
          <label htmlFor={`${id}-access`} className="text-sm font-medium">
            Access for this many days (optional)
          </label>
          <Input
            id={`${id}-access`}
            name="accessDays"
            type="number"
            min={1}
            max={730}
            defaultValue={pkg?.accessDays ?? ''}
          />
        </div>
      ) : (
        <>
          <div className={f}>
            <label htmlFor={`${id}-every`} className="text-sm font-medium">
              Charged every
            </label>
            <div className="flex gap-2">
              <Input
                id={`${id}-every`}
                name="intervalCount"
                type="number"
                min={1}
                max={12}
                defaultValue={pkg?.intervalCount ?? 1}
                className="w-24"
                aria-label="Number of weeks or months"
              />
              <select
                name="intervalUnit"
                defaultValue={pkg?.intervalUnit ?? 'month'}
                className={selectClass}
                aria-label="Weeks or months"
              >
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
            </div>
          </div>
          {kind === 'plan' && (
            <div className={f}>
              <label htmlFor={`${id}-inst`} className="text-sm font-medium">
                Number of payments (2-24)
              </label>
              <Input
                id={`${id}-inst`}
                name="installments"
                type="number"
                min={2}
                max={24}
                required
                defaultValue={pkg?.installments ?? 3}
              />
            </div>
          )}
          <div className={f}>
            <label htmlFor={`${id}-trial`} className="text-sm font-medium">
              Free trial days (optional)
            </label>
            <Input
              id={`${id}-trial`}
              name="trialDays"
              type="number"
              min={0}
              max={90}
              defaultValue={pkg?.trialDays ?? 0}
            />
          </div>
        </>
      )}
      <div className={f}>
        <label htmlFor={`${id}-tag`} className="text-sm font-medium">
          Tag buyers with (optional)
        </label>
        <select
          id={`${id}-tag`}
          name="tagId"
          defaultValue={pkg?.tagId ?? ''}
          className={selectClass}
        >
          <option value="">No tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className={f}>
        <label htmlFor={`${id}-tpl`} className="text-sm font-medium">
          Program to offer (optional)
        </label>
        <select
          id={`${id}-tpl`}
          name="templateProgramId"
          defaultValue={pkg?.templateProgramId ?? ''}
          className={selectClass}
          aria-describedby={`${id}-tpl-hint`}
        >
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <p id={`${id}-tpl-hint`} className="text-sm text-secondary">
          You confirm the client is ready before it starts.
        </p>
      </div>
      <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={credits}
          onChange={(e) => setCredits(e.target.checked)}
          className="size-5"
        />
        Includes session credits
      </label>
      {credits && (
        <>
          <div className={f}>
            <label htmlFor={`${id}-credits`} className="text-sm font-medium">
              Sessions included
            </label>
            <Input
              id={`${id}-credits`}
              name="sessionCredits"
              type="number"
              min={1}
              max={500}
              required
              defaultValue={pkg?.sessionCredits ?? 10}
            />
          </div>
          <div className={f}>
            <label htmlFor={`${id}-valid`} className="text-sm font-medium">
              Credits expire after days (optional)
            </label>
            <Input
              id={`${id}-valid`}
              name="creditsValidDays"
              type="number"
              min={1}
              max={730}
              defaultValue={pkg?.creditsValidDays ?? ''}
            />
          </div>
        </>
      )}
      <label className="flex min-h-11 items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          name="public"
          defaultChecked={pkg?.public ?? true}
          className="size-5"
        />
        Show on your public page
      </label>
      {error && (
        <p role="alert" className="text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {pkg ? 'Save package' : 'Create package'}
        </Button>
      </div>
    </form>
  );
}

/** PRD K3: what the workspace sells. */
export function PackagesSection({
  packages,
  currency,
  manager,
  tags,
  templates,
}: {
  packages: PackageView[];
  currency: string;
  manager: boolean;
  tags: Option[];
  templates: Option[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PackageView | 'new' | null>(null);
  async function setActive(p: PackageView, active: boolean) {
    const res = await send('PUT', `/api/v1/packages/${p.id}/active`, { active });
    if (res.ok) {
      toast.success(active ? 'Package restored' : 'Package archived');
      router.refresh();
    } else toast.error(res.message);
  }
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Packages</CardTitle>
          <CardDescription>Price changes apply to new purchases only.</CardDescription>
        </div>
        {manager && <Button onClick={() => setEditing('new')}>New package</Button>}
      </CardHeader>
      <CardContent>
        {packages.length === 0 ? (
          <p className="text-secondary">No packages yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">
                    {p.title}
                    {!p.active && (
                      <span className="ml-2 text-sm font-normal text-secondary">(archived)</span>
                    )}
                  </p>
                  <p className="text-sm text-secondary">
                    {priceLabel(p, currency)}
                    {trialLabel(p) && ` · ${trialLabel(p)}`}
                    {p.sessionCredits && ` · ${p.sessionCredits} sessions`}
                    {p.public ? ' · on your public page' : ' · private'}
                  </p>
                </div>
                {manager && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(p)}
                      aria-label={`Edit ${p.title}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void setActive(p, !p.active)}
                      aria-label={`${p.active ? 'Archive' : 'Restore'} ${p.title}`}
                    >
                      {p.active ? 'Archive' : 'Restore'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New package' : 'Edit package'}</DialogTitle>
            <DialogDescription>
              Clients buy packages on your public page, or you record a payment.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <PackageForm
              pkg={editing === 'new' ? null : editing}
              currency={currency}
              tags={tags}
              templates={templates}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
