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
import { SettingsNav } from '@/components/settings/SettingsNav';
import { PageHeader } from '@/components/ui/page-header';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { TwoFactorSection } from '@/components/settings/TwoFactorSection';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Settings | Repsy' };

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

  const groups = [
    {
      id: 'account',
      label: 'Your account',
      description: 'How you appear, and how you sign in.',
      body: (
        <>
          <ProfileSection profile={settings.profile} />
          <TwoFactorSection enabled={twoFactor.enabled} required={twoFactor.required} />
          <SecuritySection />
        </>
      ),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      description: 'Your business name, look, and plan.',
      body: (
        <>
          <OrganizationSection org={settings.org} canEdit={isOwner} />
          <BrandingSection branding={branding} canEdit={isOwner} />
          <PilotAccessCard
            count={settings.org.activeClientCount}
            limit={settings.org.activeClientLimit}
          />
        </>
      ),
    },
    {
      id: 'coaching',
      label: 'Coaching',
      description: 'Defaults, alerts and replies that shape your day-to-day.',
      body: (
        <>
          <TrainingDefaultsSection graceHours={settings.org.graceHours} canEdit={isOwner} />
          <NotificationsSection notifications={settings.notifications} coach />
          <MessagingSection expectations={expectations} replies={replies} canEdit={isOwner} />
          {reviewRules && <ReviewRulesSection settings={reviewRules} canEdit={isOwner} />}
        </>
      ),
    },
    {
      id: 'clients',
      label: 'Clients and public',
      description: 'What new clients agree to, and where people find you.',
      body: (
        <>
          <AgreementsSection agreements={agreements} canEdit={isOwner} />
          <PublicPageSection initial={publicPage} canEdit={isOwner} />
        </>
      ),
    },
    {
      id: 'data',
      label: 'Team and data',
      description: 'Exports, people and the record of changes.',
      body: (
        <>
          {isOwner && <DataExportSection scope="org" initial={exports} />}
          <ul className="grid gap-3 sm:grid-cols-2">
            {isOwner && (
              <>
                <li>
                  <Link href="/app/team" className={tileLink}>
                    <span className="font-medium">Team</span>
                    <span className="text-sm text-secondary">Invite coaches and set roles.</span>
                  </Link>
                </li>
                <li>
                  <Link href="/app/audit" className={tileLink}>
                    <span className="font-medium">Audit log</span>
                    <span className="text-sm text-secondary">Who changed what, and when.</span>
                  </Link>
                </li>
              </>
            )}
            <li>
              <Link href="/app/support" className={tileLink}>
                <span className="font-medium">Help and support</span>
                <span className="text-sm text-secondary">Guides, and a way to reach us.</span>
              </Link>
            </li>
          </ul>
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account, your workspace, and how coaching runs. Changes save per section."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav groups={groups.map(({ id, label }) => ({ id, label }))} />
        <div className="flex max-w-3xl min-w-0 flex-col gap-10">
          {groups.map((g) => (
            <div key={g.id} id={g.id} className="flex scroll-mt-6 flex-col gap-4">
              <div>
                <p className="text-lg font-semibold text-ink">{g.label}</p>
                <p className="text-sm text-secondary">{g.description}</p>
              </div>
              {g.body}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const tileLink =
  'flex h-full flex-col gap-0.5 rounded-card border border-border bg-surface p-4 shadow-card transition-colors duration-[var(--k-motion-fast)] hover:border-accent/40 hover:bg-surface-muted/50';
