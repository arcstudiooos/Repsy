'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell, buttonClass, Field, FormMessage, linkClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

/** Two steps on one route: request a link (no token), then choose a password (?token=...). */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: String(data.get('email')),
      redirectTo: '/reset-password',
    });
    setPending(false);
    setMessage({ tone: 'info', text: 'If that address has an account, we sent a reset link.' });
  }

  async function choosePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setPending(true);
    const data = new FormData(event.currentTarget);
    const { error } = await authClient.resetPassword({
      newPassword: String(data.get('password')),
      token,
    });
    setPending(false);
    setMessage(
      error
        ? { tone: 'error', text: error.message ?? 'This link is invalid or has expired.' }
        : { tone: 'info', text: 'Password updated. You can sign in now.' },
    );
  }

  return (
    <AuthShell title={token ? 'Choose a new password' : 'Reset your password'}>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      {token ? (
        <form onSubmit={choosePassword}>
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            hint="At least 12 characters."
          />
          <button type="submit" className={buttonClass} disabled={pending}>
            Update password
          </button>
        </form>
      ) : (
        <form onSubmit={requestLink}>
          <Field label="Email" name="email" type="email" autoComplete="email" />
          <button type="submit" className={buttonClass} disabled={pending}>
            Send reset link
          </button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className={linkClass}>
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
