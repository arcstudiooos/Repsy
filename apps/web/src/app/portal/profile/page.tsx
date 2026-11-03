import type { Metadata } from 'next';
import Link from 'next/link';
import {
  deletionStatusFor,
  getSettings,
  hasCalendarFeed,
  listMyExports,
  twoFactorStatus,
} from '@kinetic/core';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { ClientPreferencesSection } from '@/components/settings/ClientSections';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { TwoFactorSection } from '@/components/settings/TwoFactorSection';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { CalendarLink } from '@/portal/CalendarLink';
import { PushToggle } from '@/portal/PushToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Profile | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalProfile() {
  const { settings, exports, deletion, twoFactor, calendar } = await withPortalTenant(
    async (tx, actor) => ({
      settings: await getSettings(tx, actor),
      exports: await listMyExports(tx, actor),
      deletion: await deletionStatusFor(tx, actor),
      twoFactor: await twoFactorStatus(tx, actor),
      calendar: await hasCalendarFeed(tx, actor),
    }),
  );
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Profile</h1>
      <div className="flex flex-col gap-6">
        {settings.client && <ClientPreferencesSection client={settings.client} />}
        <NotificationsSection notifications={settings.notifications} />
        <PushToggle />
        <CalendarLink active={calendar} />
        <DataExportSection scope="client_self" initial={exports}>
          <DeletionRequestButton current={deletion} />
        </DataExportSection>
        <TwoFactorSection enabled={twoFactor.enabled} required={false} />
        <SecuritySection />
        <p className="text-secondary">
          Plans, payments and receipts:{' '}
          <Link href="/portal/billing" className="text-accent underline">
            Billing
          </Link>
        </p>
        <p className="text-secondary">
          Need help?{' '}
          <Link href="/portal/support" className="text-accent underline">
            Help and support
          </Link>
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <SignOutButton
              className="border border-input-border px-4 text-ink"
              redirectTo="/login"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
