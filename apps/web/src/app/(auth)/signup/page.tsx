import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Create account | Repsy',
  description:
    'Start Repsy free with 3 clients. Programs, check-ins, messages and scheduling for coaches, no card needed.',
  alternates: { canonical: '/signup' },
};

/** Reads the Google keys at request time, so the button appears as soon as they are set. */
async function SignupWithGoogle({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const failed = (await searchParams)?.google === 'failed';
  return <SignupForm google={google} googleFailed={failed} />;
}

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<SignupForm google={false} googleFailed={false} />}>
      <SignupWithGoogle searchParams={searchParams} />
    </Suspense>
  );
}
