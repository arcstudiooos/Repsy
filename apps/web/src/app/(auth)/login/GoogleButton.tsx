import Link from 'next/link';
import { connection } from 'next/server';
import { FormMessage } from '@/components/auth-ui';
import { microsoftSsoConfigured } from '@/lib/auth';
import { GoogleSignInButton, MicrosoftSignInButton } from './GoogleSignInButton';
import { ssoMessage } from './ssoMessage';

/** Social and SSO buttons, each only when its env vars are set (read at request time, not build time). */
export async function GoogleButton({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  // PRD A16: a provider sign-in that came back with an error (no account for that email, or the wrong Microsoft
  // directory). Google and Microsoft return to different URLs so the message fits the provider.
  const params = (await searchParams) ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const message = ssoMessage(one(params.sso), one(params.error));
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const microsoft = microsoftSsoConfigured();
  if (!google && !microsoft) return null;
  return (
    <>
      {message && (
        <FormMessage tone="error">
          {message.text}
          {message.signUpLink && (
            <>
              {' '}
              <Link href="/signup" className="underline">
                Go to sign up
              </Link>
            </>
          )}
        </FormMessage>
      )}
      {google && <GoogleSignInButton />}
      {microsoft && <MicrosoftSignInButton />}
    </>
  );
}
