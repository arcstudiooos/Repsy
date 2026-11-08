'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  AuthShell,
  buttonClass,
  Field,
  FormMessage,
  linkClass,
  RequiredNote,
} from '@/components/auth-ui';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { GoogleSignUpButton } from '../login/GoogleSignInButton';
import { signUpCoachAction, type SignupState } from './actions';

export function SignupForm({
  google,
  googleFailed,
}: {
  /** The server has Google keys. */
  google: boolean;
  /** Back from a Google sign-up that did not finish. */
  googleFailed: boolean;
}) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUpCoachAction, {});
  const errors = state.fieldErrors ?? {};
  return (
    <AuthShell title="Create your coach account">
      {google && (
        <div className="mb-6">
          {googleFailed && (
            <FormMessage tone="error">
              Google sign-up did not finish. If you already have an account, sign in instead.
            </FormMessage>
          )}
          <GoogleSignUpButton />
          <p className="mt-2 text-sm text-secondary">
            You set up your business name and time zone next. By continuing you agree to the{' '}
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>{' '}
            and the{' '}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </p>
          <p className="mt-6 text-center text-sm text-secondary">or sign up with email</p>
        </div>
      )}
      <form action={action}>
        {errors.form && <FormMessage tone="error">{errors.form}</FormMessage>}
        <RequiredNote />
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
        <TimezoneSelect
          label="Time zone"
          name="timezone"
          hint="Used for reminders and check-in times. We picked yours from this device."
          error={errors.timezone}
        />
        <Field
          label="Pilot code (optional)"
          name="pilotCode"
          required={false}
          hint="No code? You get a free 7-day trial for up to 3 clients."
          error={errors.pilotCode}
        />
        <p className="mb-4 text-sm text-secondary">
          By creating an account you agree to the{' '}
          <Link href="/terms" className={linkClass}>
            Terms of Service
          </Link>{' '}
          and the{' '}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </p>
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
