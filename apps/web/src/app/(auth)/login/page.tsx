import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GoogleButton } from './GoogleButton';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in | Repsy' };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <LoginForm
      google={
        <Suspense fallback={null}>
          <GoogleButton searchParams={searchParams} />
        </Suspense>
      }
    />
  );
}
