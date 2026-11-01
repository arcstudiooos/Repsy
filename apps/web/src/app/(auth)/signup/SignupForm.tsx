'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { AuthShell, buttonClass, Field, FormMessage, linkClass } from '@/components/auth-ui';
import { signUpCoachAction, type SignupState } from './actions';

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUpCoachAction, {});
  const errors = state.fieldErrors ?? {};
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <AuthShell title="Create your coach account">
      <form action={action}>
        {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}
        <Field label="Your name" name="name" autoComplete="name" error={errors.name} />
        <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          hint="At least 12 characters."
          error={errors.password}
        />
        <Field label="Business name" name="orgName" error={errors.orgName} />
        <Field
          label="Time zone"
          name="timezone"
          defaultValue={browserZone}
          hint="For example Europe/London."
          error={errors.timezone}
        />
        <Field
          label="Pilot code (optional)"
          name="pilotCode"
          required={false}
          hint="No code? You get a free 14-day trial for up to 3 clients."
          error={errors.pilotCode}
        />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? 'Creating account' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
