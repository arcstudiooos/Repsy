import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getPublicProfile, getStorefront, lookupJoinLink } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { AuthShell } from '@/components/auth-ui';
import { LoadingState } from '@/components/states/LoadingState';
import { priceLabel, trialLabel } from '@/lib/billing-format';
import { ApplyForm } from './ApplyForm';
import { BuyForm } from './BuyForm';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'Join your coach | Kinetic',
  // The URL carries a secret: never let it leak through referrers or indexes.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** PRD B15: a coach's public page: their bio, offers and an application form. */
async function PublicPage({ slug }: { slug: string }) {
  const profile = await getPublicProfile(prisma, slug);
  const store = profile ? await getStorefront(prisma, slug) : null;
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
      {store && store.packages.length > 0 && (
        <section aria-labelledby="packages-heading" className="mb-6 flex flex-col gap-4">
          <h2 id="packages-heading" className="text-lg font-semibold">
            Packages
          </h2>
          {store.packages.map((p) => (
            <details key={p.id} className="rounded-card border border-input-border p-4">
              <summary className="flex min-h-11 cursor-pointer flex-col justify-center">
                <span className="font-semibold">{p.title}</span>
                <span className="text-sm text-secondary">
                  {priceLabel(p, p.currency)}
                  {trialLabel(p) && ` · ${trialLabel(p)}`}
                </span>
              </summary>
              {p.description && <p className="my-3 whitespace-pre-line">{p.description}</p>}
              <BuyForm slug={slug} packageId={p.id} title={p.title} asksRegion={store.asksRegion} />
            </details>
          ))}
        </section>
      )}
      <h2 className="mb-2 text-lg font-semibold">Apply</h2>
      <ApplyForm slug={slug} orgName={profile.orgName} />
    </AuthShell>
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
