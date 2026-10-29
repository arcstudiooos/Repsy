import type { Metadata } from 'next';
import { getSettings } from '@kinetic/core';
import { ClientPreferencesSection } from '@/components/settings/ClientSections';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Profile | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
export default async function PortalProfile() {
  const settings = await withServerTenant((tx, actor) => getSettings(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Profile</h1>
      <div className="flex flex-col gap-6">
        {settings.client && <ClientPreferencesSection client={settings.client} />}
        <NotificationsSection notifications={settings.notifications} />
        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>Available soon.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="secondary" disabled>
              Download my data · Available soon
            </Button>
            <Button type="button" variant="secondary" disabled>
              Request deletion · Available soon
            </Button>
          </CardContent>
        </Card>
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
