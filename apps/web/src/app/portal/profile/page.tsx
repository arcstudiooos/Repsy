import type { Metadata } from 'next';
import { deletionStatusFor, getSettings, listMyExports } from '@kinetic/core';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { ClientPreferencesSection } from '@/components/settings/ClientSections';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Profile | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalProfile() {
  const { settings, exports, deletion } = await withServerTenant(async (tx, actor) => ({
    settings: await getSettings(tx, actor),
    exports: await listMyExports(tx, actor),
    deletion: await deletionStatusFor(tx, actor),
  }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Profile</h1>
      <div className="flex flex-col gap-6">
        {settings.client && <ClientPreferencesSection client={settings.client} />}
        <NotificationsSection notifications={settings.notifications} />
        <DataExportSection scope="client_self" initial={exports}>
          <DeletionRequestButton current={deletion} />
        </DataExportSection>
        <SecuritySection />
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
