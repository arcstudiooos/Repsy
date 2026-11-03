import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GoogleButton } from './GoogleButton';
import { LoginForm } from './LoginForm';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

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
