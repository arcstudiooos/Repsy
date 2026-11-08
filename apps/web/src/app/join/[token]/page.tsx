import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  formatMoneyMinor,
  getPublicProfile,
  getPublicStorefront,
  lookupJoinLink,
} from '@repsy/core';
import { prisma } from '@repsy/db';
import { AuthShell } from '@/components/auth-ui';
import { LoadingState } from '@/components/states/LoadingState';
import { ApplyForm } from './ApplyForm';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'Join your coach | Repsy',
  // The URL carries a secret: never let it leak through referrers or indexes.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** PRD B15: a coach's public page: their bio, offers and an application form. */
async function PublicPage({ slug }: { slug: string }) {
  const profile = await getPublicProfile(prisma, slug);
  if (!profile) {
    return (
      <AuthShell title="Page not found">
        <p role="alert" className="text-base">
          This page doesn&apos;t exist or isn&apos;t taking applications.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={profile.orgName}>
      {profile.bio && <p className="mb-4 text-base whitespace-pre-line">{profile.bio}</p>}
      {profile.offers && (
        <section aria-labelledby="offers-heading" className="mb-6">
          <h2 id="offers-heading" className="mb-1 text-lg font-semibold">
            What I offer
          </h2>
          <p className="text-base whitespace-pre-line">{profile.offers}</p>
        </section>
      )}
      <StorefrontPackages slug={slug} />
      <h2 className="mb-2 text-lg font-semibold">Apply</h2>
      <ApplyForm slug={slug} orgName={profile.orgName} />
    </AuthShell>
  );
}

/** PRD K4: the storefront on the public page — active packages and prices. Buying is not open to anonymous visitors: ask the coach for a checkout link (a coach creates it, and the buyer pays on hosted checkout). Nothing here changes the sign-up link path below. */
async function StorefrontPackages({ slug }: { slug: string }) {
  const storefront = await getPublicStorefront(prisma, slug);
  if (!storefront || storefront.packages.length === 0) return null;
  return (
    <section aria-labelledby="packages-heading" className="mb-6">
      <h2 id="packages-heading" className="mb-2 text-lg font-semibold">
        Packages
      </h2>
      <ul className="flex flex-col gap-3">
        {storefront.packages.map((pkg) => (
          <li key={pkg.id} className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-medium">{pkg.title}</p>
            {pkg.description && <p className="text-sm text-secondary">{pkg.description}</p>}
            <p className="mt-1 text-base">
              {formatMoneyMinor(pkg.amountMinor, pkg.currency)}
              {pkg.kind === 'recurring' && pkg.interval === 'week' && ' per week'}
              {pkg.kind === 'recurring' && pkg.interval === 'month' && ' per month'}
              {pkg.kind === 'payment_plan' && pkg.installments && ` × ${pkg.installments} payments`}
              {pkg.trialDays > 0 && ` · ${pkg.trialDays}-day free trial`}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-secondary">
        Ask your coach for a checkout link for one of these packages.
      </p>
    </section>
  );
}

async function JoinBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A public page slug is 3-40 characters; a sign-up link's token is 43.
  if (token.length <= 40) return <PublicPage slug={token} />;
  const link = await lookupJoinLink(token);
  if (!link || !link.usable) {
    return (
      <AuthShell title="This sign-up link can't be used">
        <p role="alert" className="text-base">
          It may have expired, been used up or been turned off. Ask your coach for a new one.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${link.orgName}`}>
      <p className="mb-4 text-base">
        Enter your name and email. We&apos;ll email you a link to set up your account.
      </p>
      <JoinForm token={token} orgName={link.orgName} />
    </AuthShell>
  );
}

/** PRD B3: the public page behind a workspace sign-up link. */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <JoinBody params={params} />
    </Suspense>
  );
}
