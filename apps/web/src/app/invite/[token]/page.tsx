import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  classifyInvite,
  hashInviteToken,
  inviteFailureMessage,
  PRIVACY_NOTICE_TEXT,
} from '@kinetic/core';
import { findInviteByTokenHash } from '@kinetic/db';
import { AuthShell, linkClass } from '@/components/auth-ui';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { maskEmail } from '@/lib/mask-email';
import { AcceptForm } from './AcceptForm';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = {
  title: 'Join your coach | Kinetic',
  // The URL carries a secret: never let it leak through referrers or indexes.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

async function InviteBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await findInviteByTokenHash(hashInviteToken(token));
  const state = classifyInvite(lookup, new Date());
  if (state !== 'ok' || !lookup) {
    return (
      <AuthShell title="This invite can't be used">
        <p role="alert" className="mb-4 text-base">
          {inviteFailureMessage(state === 'ok' ? 'INVITE_INVALID' : state)}
        </p>
        <Link href="/login" className={linkClass}>
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  const user = await getSessionUser(await headers());
  if (user && user.email.toLowerCase() !== lookup.email.toLowerCase()) {
    return (
      <AuthShell title="Wrong account">
        <p role="alert" className="mb-4 text-base">
          This invite was sent to {maskEmail(lookup.email)}. Sign out to accept it.
        </p>
        <SignOutButton redirectTo={`/invite/${token}`} className="w-full justify-start px-3" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${lookup.orgName}`}>
      <p className="mb-4 text-base">
        Hi {lookup.clientName}, you have been invited to train with {lookup.orgName}.
      </p>
      <AcceptForm
        token={token}
        orgName={lookup.orgName}
        email={lookup.email}
        signedIn={user !== null}
        privacyText={PRIVACY_NOTICE_TEXT}
        timezones={timeZones()}
      />
      {user === null && (
        <p className="mt-4 text-sm">
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className={linkClass}
          >
            Sign in
          </Link>
        </p>
      )}
    </AuthShell>
  );
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <InviteBody params={params} />
    </Suspense>
  );
}
