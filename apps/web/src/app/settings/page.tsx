import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  getReplyExpectations,
  getReviewRuleSettings,
  getSettings,
  listMyExports,
  listSavedReplies,
} from '@kinetic/core';
import { DataExportSection } from '@/components/settings/DataExportSection';
import {
  OrganizationSection,
  ProfileSection,
  TrainingDefaultsSection,
} from '@/components/settings/CoachSections';
import { MessagingSection } from '@/components/settings/MessagingSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { ReviewRulesSection } from '@/components/settings/ReviewRulesSection';
import { PilotAccessCard } from '@/components/settings/PilotAccessCard';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Settings | Kinetic' };

// Access is enforced by src/proxy.ts and the coach shell in the settings layout.
export default async function SettingsPage() {
  const { actor, settings, exports, expectations, replies, reviewRules } = await withServerTenant(
    async (tx, a) => ({
      actor: a,
      settings: a.role === 'client' ? null : await getSettings(tx, a),
      exports: a.role === 'owner' ? await listMyExports(tx, a) : [],
      expectations: await getReplyExpectations(tx, a),
      replies: a.role === 'client' ? [] : await listSavedReplies(tx, a),
      reviewRules: a.role === 'client' ? null : await getReviewRuleSettings(tx, a),
    }),
  );
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
        <NotificationsSection notifications={settings.notifications} coach />
        <MessagingSection expectations={expectations} replies={replies} canEdit={isOwner} />
        {reviewRules && <ReviewRulesSection settings={reviewRules} canEdit={isOwner} />}
        <PilotAccessCard
          count={settings.org.activeClientCount}
          limit={settings.org.activeClientLimit}
        />
        {isOwner && <DataExportSection scope="org" initial={exports} />}
        <SecuritySection />
      </div>
    </>
  );
}
