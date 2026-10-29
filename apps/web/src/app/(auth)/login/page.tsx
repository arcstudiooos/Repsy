import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GoogleButton } from './GoogleButton';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in | Kinetic' };

export default function LoginPage() {
  return (
    <LoginForm
      google={
        <Suspense fallback={null}>
          <GoogleButton />
        </Suspense>
      }
    />
  );
}
