'use client';

import { useActionState } from 'react';
import { buttonClass, Field, FormMessage } from '@/components/auth-ui';
import { joinAction, type JoinState } from './actions';

export function JoinForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinAction, {});
  if (state.status === 'sent') {
    return (
      <FormMessage tone="info">
        Check your email. We sent you a link to finish joining {orgName}. It works once and expires
        in 7 days.
      </FormMessage>
    );
  }
  return (
    <form action={action} noValidate>
      {state.status === 'closed' && (
        <FormMessage tone="error">
          This sign-up link no longer works. Ask your coach for a new one.
        </FormMessage>
      )}
      {state.status === 'full' && (
        <FormMessage tone="error">
          {orgName} isn&apos;t taking new sign-ups right now. Ask your coach.
        </FormMessage>
      )}
      {state.fieldErrors?.form && <FormMessage tone="error">{state.fieldErrors.form}</FormMessage>}
      <input type="hidden" name="token" value={token} />
      <Field label="Your name" name="name" autoComplete="name" error={state.fieldErrors?.name} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        error={state.fieldErrors?.email}
      />
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? 'Sending' : 'Send me an invite'}
      </button>
    </form>
  );
}
