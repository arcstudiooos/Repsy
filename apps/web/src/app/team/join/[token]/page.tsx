import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { lookupTeamInvite } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { AuthShell, linkClass } from '@/components/auth-ui';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { maskEmail } from '@/lib/mask-email';
import { JoinButton } from './JoinButton';

export const metadata: Metadata = {
  title: 'Join the team | Kinetic',
  // The URL carries a secret.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const ROLE_TEXT = { admin: 'an admin', coach: 'a coach', assistant: 'an assistant' } as const;

async function JoinBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await lookupTeamInvite(prisma, token);
  if (!invite || invite.state !== 'open') {
    return (
      <AuthShell title="This invite can't be used">
        <p role="alert" className="mb-4 text-base">
          {invite?.state === 'expired'
            ? 'This invite has expired. Ask for a new one.'
            : 'This invite was already used or turned off.'}
        </p>
        <Link href="/login" className={linkClass}>
          Go to sign in
        </Link>
      </AuthShell>
    );
  }
  const next = encodeURIComponent(`/team/join/${token}`);
  const user = await getSessionUser(await headers());
  if (!user) {
    return (
      <AuthShell title={`Join ${invite.orgName}`}>
        <p className="mb-4 text-base">
          You&apos;re invited to join as {ROLE_TEXT[invite.role]}. Sign in, or create an account,
          with {maskEmail(invite.email)}.
        </p>
        <div className="flex flex-col gap-2">
          <Link href={`/login?next=${next}`} className={linkClass}>
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-secondary">
          New to Kinetic?{' '}
          <Link href="/signup" className={linkClass}>
            Create an account
          </Link>{' '}
          with that email, then open this invite link again.
        </p>
      </AuthShell>
    );
  }
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthShell title="Wrong account">
        <p role="alert" className="mb-4 text-base">
          This invite was sent to {maskEmail(invite.email)}. Sign out, then sign in with that email.
        </p>
        <SignOutButton redirectTo={`/team/join/${token}`} className="w-full justify-start px-3" />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${invite.orgName}`}>
      <p className="mb-4 text-base">You&apos;re invited to join as {ROLE_TEXT[invite.role]}.</p>
      <JoinButton token={token} label={`Join ${invite.orgName}`} />
    </AuthShell>
  );
}

/** PRD A10: accepting a team invite. Public; the token is the credential. */
export default function TeamJoinPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <JoinBody params={params} />
    </Suspense>
  );
}
