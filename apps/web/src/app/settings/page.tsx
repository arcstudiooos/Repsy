import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getBranding,
  getReplyExpectations,
  getReviewRuleSettings,
  getSettings,
  listMyExports,
  listSavedReplies,
  twoFactorStatus,
  listAgreements,
  isManager,
  getPublicPageSettings,
} from '@kinetic/core';
import { AgreementsSection } from '@/components/settings/AgreementsSection';
import { PublicPageSection } from '@/components/settings/PublicPageSection';
import { BrandingSection } from '@/components/settings/BrandingSection';
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
import { TwoFactorSection } from '@/components/settings/TwoFactorSection';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Settings | Kinetic' };

// Access is enforced by src/proxy.ts and the coach shell in the settings layout.
export default async function SettingsPage() {
  const {
    actor,
    settings,
    exports,
    expectations,
    replies,
    reviewRules,
    agreements,
    publicPage,
    branding,
    twoFactor,
  } = await withServerTenant(async (tx, a) => ({
    actor: a,
    settings: a.role === 'client' ? null : await getSettings(tx, a),
    exports: a.role === 'owner' ? await listMyExports(tx, a) : [],
    expectations: await getReplyExpectations(tx, a),
    replies: a.role === 'client' ? [] : await listSavedReplies(tx, a),
    reviewRules: a.role === 'client' ? null : await getReviewRuleSettings(tx, a),
    agreements: a.role === 'client' ? [] : await listAgreements(tx),
    publicPage: await getPublicPageSettings(tx),
    branding: await getBranding(tx),
    twoFactor: await twoFactorStatus(tx, a),
  }));
  // A client who lands here belongs in their portal.
  if (!settings?.profile || !settings.org) redirect('/portal/profile');
  // Owners and admins run the workspace settings (PRD A10); only the owner exports its data.
  const isOwner = isManager(actor.role);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Settings</h1>
      <div className="flex max-w-2xl flex-col gap-6">
        <ProfileSection profile={settings.profile} />
        <OrganizationSection org={settings.org} canEdit={isOwner} />
        <BrandingSection branding={branding} canEdit={isOwner} />
        <TrainingDefaultsSection graceHours={settings.org.graceHours} canEdit={isOwner} />
        <NotificationsSection notifications={settings.notifications} coach />
        <MessagingSection expectations={expectations} replies={replies} canEdit={isOwner} />
        {reviewRules && <ReviewRulesSection settings={reviewRules} canEdit={isOwner} />}
        <AgreementsSection agreements={agreements} canEdit={isOwner} />
        <PublicPageSection initial={publicPage} canEdit={isOwner} />
        <PilotAccessCard
          count={settings.org.activeClientCount}
          limit={settings.org.activeClientLimit}
        />
        {isOwner && <DataExportSection scope="org" initial={exports} />}
        {isOwner && (
          <p className="text-secondary">
            <Link href="/app/team" className="text-accent underline">
              Team
            </Link>{' '}
            · Who changed what, and when:{' '}
            <Link href="/app/audit" className="text-accent underline">
              Audit log
            </Link>
          </p>
        )}
        <TwoFactorSection enabled={twoFactor.enabled} required={twoFactor.required} />
        <SecuritySection />
        <p className="text-secondary">
          Need help?{' '}
          <Link href="/app/support" className="text-accent underline">
            Help and support
          </Link>
        </p>
      </div>
    </>
  );
}
