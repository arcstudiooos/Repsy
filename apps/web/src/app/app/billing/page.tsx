import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartColumn, Check } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  can,
  getPaymentSettings,
  listCoupons,
  listPackages,
  listPayments,
  listPrograms,
  listTags,
} from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { availableProviders } from '@/server/payments';
import { withServerTenant } from '@/server/serverActor';
import { ConnectCard } from './ConnectCard';
import { CouponsSection } from './CouponsSection';
import { PackagesSection } from './PackagesSection';
import { PaymentsTable } from '@/components/billing/PaymentsTable';
import { SettingsForm } from './SettingsForm';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Billing | Kinetic' };

const DAY = 86_400_000;
/** The payments window: read per request (a server component, so there is no re-render to keep stable). */
const last90Days = () => new Date(Date.now() - 90 * DAY);

/** PRD K1-K6, K9, K15: how a workspace takes payments, what it sells and what came in. */
export default async function BillingPage() {
  const data = await withServerTenant(async (tx, actor) => {
    const manager = can(actor, 'billing:manage');
    return {
      manager,
      settings: await getPaymentSettings(tx, actor),
      packages: await listPackages(tx, actor, { includeArchived: manager }),
      coupons: manager ? await listCoupons(tx, actor) : [],
      payments: await listPayments(tx, actor, { from: last90Days() }),
      tags: manager ? (await listTags(tx, actor)).map((t) => ({ id: t.id, name: t.name })) : [],
      templates: manager
        ? (await listPrograms(tx, actor, { kind: 'template' })).items
            .filter((p) => p.versionNo !== null)
            .map((p) => ({ id: p.id, title: p.title }))
        : [],
    };
  });
  const { settings } = data;
  const currency = settings.currency;
  // PRD K1-K3: the order a new workspace sets payments up in.
  const done = [settings.account !== null, currency !== null, data.packages.length > 0];
  const firstOpen = done.indexOf(false);
  const steps = ['Connect a payment account', 'Pick your currency', 'Create a package'].map(
    (label, i) => ({ label, done: done[i]!, current: i === firstOpen }),
  );
  const setupDone = firstOpen === -1;
  return (
    <>
      <PageHeader
        title="Billing"
        description="Sell packages, take card and UPI payments, and record cash or bank transfers."
        actions={
          <Link href="/app/analytics/business" className={buttonVariants({ variant: 'secondary' })}>
            <ChartColumn aria-hidden className="size-4" />
            See revenue
          </Link>
        }
      />
      {data.manager && !setupDone && (
        <ol
          aria-label="Set up payments"
          className="mb-6 grid gap-2 rounded-card border border-border bg-surface p-3 shadow-card sm:grid-cols-3"
        >
          {steps.map((step, i) => (
            <li
              key={step.label}
              className={cn(
                'flex items-center gap-3 rounded-control px-3 py-2',
                step.current && 'bg-accent-soft/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  step.done
                    ? 'bg-accent text-white'
                    : step.current
                      ? 'border-[1.5px] border-accent text-accent-ink'
                      : 'border-[1.5px] border-input-border text-secondary',
                )}
              >
                {step.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className="text-sm">
                <span
                  className={cn(
                    'block font-medium',
                    !step.done && !step.current && 'text-secondary',
                  )}
                >
                  {step.label}
                </span>
                <span className="text-secondary">
                  {step.done ? 'Done' : step.current ? 'Next' : 'Later'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-col gap-6">
        {data.manager && (
          <>
            <ConnectCard account={settings.account} providers={availableProviders()} />
            <SettingsForm settings={settings} />
          </>
        )}
        {currency ? (
          <PackagesSection
            packages={data.packages}
            currency={currency}
            manager={data.manager}
            tags={data.tags}
            templates={data.templates}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Packages</CardTitle>
              <CardDescription>
                {data.manager
                  ? 'Pick your currency above to create packages.'
                  : 'The workspace owner sets up payments first.'}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {data.manager && currency && <CouponsSection coupons={data.coupons} currency={currency} />}
        <Card>
          <CardHeader>
            <CardTitle>Payments in the last 90 days</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentsTable payments={data.payments} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
