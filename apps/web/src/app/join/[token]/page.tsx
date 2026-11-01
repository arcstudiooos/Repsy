import type { Metadata } from 'next';
import { Suspense } from 'react';
import { lookupJoinLink } from '@kinetic/core';
import { AuthShell } from '@/components/auth-ui';
import { LoadingState } from '@/components/states/LoadingState';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'Join your coach | Kinetic',
  // The URL carries a secret: never let it leak through referrers or indexes.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

async function JoinBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
