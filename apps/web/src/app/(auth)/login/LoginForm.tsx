'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AuthShell, buttonClass, Field, FormMessage, linkClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';

export function LoginForm({ google }: { google: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // PRD A8: after the password, accounts with two-step sign-in enter a code.
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [backup, setBackup] = useState(false);

  const nextUrl = () =>
    safeNext(new URLSearchParams(window.location.search).get('next'), window.location.origin);

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get('code')).replace(/\s+/g, '');
    const { error: failure } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (failure) {
      setPending(false);
      if (failure.code === 'INVALID_TWO_FACTOR_COOKIE') {
        setError('Your sign-in timed out. Enter your email and password again.');
        setStep('password');
      } else if (
        failure.code === 'ACCOUNT_TEMPORARILY_LOCKED' ||
        failure.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'
      ) {
        setError('Too many wrong codes. Wait a few minutes, then try again.');
      } else {
        setError("That code didn't work. Check it and try again.");
      }
      return;
    }
    window.location.assign(nextUrl());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(event.currentTarget);
    const next = safeNext(
      new URLSearchParams(window.location.search).get('next'),
      window.location.origin,
    );
    const { data: result, error: failure } = await authClient.signIn.email({
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
    if (result && 'twoFactorRedirect' in result && result.twoFactorRedirect) {
      setPending(false);
      setStep('code');
      return;
    }
    window.location.assign(next);
  }

  if (step === 'code') {
    return (
      <AuthShell title="Two-step sign-in">
        <form onSubmit={onCode}>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <p className="mb-4 text-sm">
            {backup
              ? 'Enter one of the backup codes you saved. Each works once.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
          <Field
            key={backup ? 'backup' : 'totp'}
            label={backup ? 'Backup code' : 'Authentication code'}
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode={backup ? 'text' : 'numeric'}
          />
          <button type="submit" className={buttonClass} disabled={pending}>
            {pending ? 'Checking' : 'Verify'}
          </button>
        </form>
        <p className="mt-4 text-sm">
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setBackup((b) => !b);
              setError(null);
            }}
          >
            {backup ? 'Use your authenticator app instead' : 'Use a backup code instead'}
          </button>
        </p>
      </AuthShell>
    );
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
