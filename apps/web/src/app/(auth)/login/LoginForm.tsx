'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AuthShell, buttonClass, Field, FormMessage, linkClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

/** Only same-site relative paths are honored after login. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export function LoginForm({ google }: { google: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    const next = safeNext(new URLSearchParams(window.location.search).get('next'));
    const { error: failure } = await authClient.signIn.email({
      email: String(data.get('email')),
      password: String(data.get('password')),
    });
    if (failure) {
      setPending(false);
      setError(
        failure.status === 403
          ? 'Verify your email first. We sent you a new link.'
          : 'Email or password is incorrect.',
      );
      return;
    }
    window.location.assign(next);
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={onSubmit}>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Signing in' : 'Sign in'}
        </button>
      </form>
      {google}
      <p className="mt-4 text-sm">
        <Link href="/reset-password" className={linkClass}>
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-sm">
        New coach?{' '}
        <Link href="/signup" className={linkClass}>
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
