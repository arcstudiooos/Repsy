import type { Metadata } from 'next';
import Link from 'next/link';
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
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Billing</h1>
      <p className="mb-6 text-secondary">
        Sell packages, take card and UPI payments, and record cash or bank transfers.{' '}
        <Link href="/app/analytics/business" className="text-accent underline underline-offset-4">
          See revenue
        </Link>
      </p>
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
