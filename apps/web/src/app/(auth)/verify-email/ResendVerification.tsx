'use client';

import { useState, type FormEvent } from 'react';
import { buttonClass, Field, FormMessage } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

export function ResendVerification() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const data = new FormData(event.currentTarget);
    // The response is the same whether or not the address exists.
    await authClient.sendVerificationEmail({
      email: String(data.get('email')),
      callbackURL: '/app',
    });
    setPending(false);
    setSent(true);
  }

  return (
    <form method="post" onSubmit={onSubmit}>
      {sent && (
        <FormMessage tone="info">If that address needs verifying, we sent a new link.</FormMessage>
      )}
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <button type="submit" className={buttonClass} disabled={pending}>
        Resend link
      </button>
    </form>
  );
}
