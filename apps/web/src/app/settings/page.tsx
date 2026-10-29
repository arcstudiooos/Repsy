import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSettings } from '@kinetic/core';
import {
  OrganizationSection,
  ProfileSection,
  TrainingDefaultsSection,
} from '@/components/settings/CoachSections';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { PilotAccessCard } from '@/components/settings/PilotAccessCard';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Settings | Kinetic' };

// Access is enforced by src/proxy.ts and the coach shell in the settings layout.
export default async function SettingsPage() {
  const { actor, settings } = await withServerTenant(async (tx, a) => ({
    actor: a,
    settings: a.role === 'client' ? null : await getSettings(tx, a),
  }));
  // A client who lands here belongs in their portal.
  if (!settings?.profile || !settings.org) redirect('/portal/profile');
  const isOwner = actor.role === 'owner';

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Settings</h1>
      <div className="flex max-w-2xl flex-col gap-6">
        <ProfileSection profile={settings.profile} />
        <OrganizationSection org={settings.org} canEdit={isOwner} />
        <TrainingDefaultsSection graceHours={settings.org.graceHours} canEdit={isOwner} />
        <NotificationsSection notifications={settings.notifications} />
        <PilotAccessCard
          count={settings.org.activeClientCount}
          limit={settings.org.activeClientLimit}
        />
        <SecuritySection />
      </div>
    </>
  );
}
