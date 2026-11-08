import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DomainError } from '@repsy/core';
import { Landing as MarketingHome } from '@/components/marketing/Landing';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { ONBOARDING_PATH } from '@/lib/membership';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteUrl } from '@/lib/site';
import { homeJsonLd, jsonLdScript } from '@/lib/structuredData';
import { loadMemberships, resolveActor } from '@/server/actor';

/**
 * Role-based landing. Signed out -> the marketing home page. Otherwise the active org (signed
 * cookie, else the only membership) decides: owner/coach -> /app, client ->
 * /portal. Several memberships and no valid cookie -> /select-org.
 */
async function Landing() {
  const h = await headers();
  const user = await getSessionUser(h);
  // Signed out: the marketing home page (landing PRD). Signed in: straight to the right shell.
  if (!user) return <MarketingHome />;
  if (!user.emailVerified) redirect('/verify-email');

  const memberships = await loadMemberships(user.id);
  let target: string;
  try {
    const actor = resolveActor(h.get('cookie'), user, memberships);
    target = actor.role === 'client' ? '/portal' : '/app';
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // No workspace at all -> pilot-code recovery; ambiguous or stale org -> chooser.
    target =
      memberships.length > 0 ? '/select-org' : user.isPlatformAdmin ? '/admin' : ONBOARDING_PATH;
  }
  redirect(target);
}

const TITLE = `${SITE_NAME} | ${SITE_TAGLINE}`;
const SHARE_DESCRIPTION =
  'Programs, check-ins, messages and scheduling in one place. Every feature on every plan.';

export const metadata: Metadata = {
  title: TITLE,
  description: SITE_DESCRIPTION,
  // The same page answers on the app host too: point both at the marketing host (SEO/AEO audit 2026-11-06).
  alternates: { canonical: `${siteUrl}/` },
  openGraph: {
    title: TITLE,
    description: SHARE_DESCRIPTION,
    url: `${siteUrl}/`,
    siteName: SITE_NAME,
    locale: 'en_US',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: SHARE_DESCRIPTION },
};

export default function Home() {
  // Session + cookies are runtime data: keep them behind a boundary (cacheComponents).
  // The JSON-LD is static, so it sits outside the boundary and lands in the prerendered HTML.
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(homeJsonLd()) }}
      />
      <Suspense fallback={<LoadingState />}>
        <Landing />
      </Suspense>
    </>
  );
}
