import { connection } from 'next/server';
import { FormMessage } from '@/components/auth-ui';
import { microsoftSsoConfigured } from '@/lib/auth';
import { GoogleSignInButton, MicrosoftSignInButton } from './GoogleSignInButton';

/** Social and SSO buttons, each only when its env vars are set (read at request time, not build time). */
export async function GoogleButton({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  // PRD A16: a provider sign-in that was refused (no invited account, or the wrong Microsoft directory).
  const refused = (await searchParams)?.sso === 'refused';
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const microsoft = microsoftSsoConfigured();
  if (!google && !microsoft) return null;
  return (
    <>
      {refused && (
        <FormMessage tone="error">
          That sign-in was refused. Ask your workspace owner to invite you with this email, or to
          set up single sign-on for your organisation.
        </FormMessage>
      )}
      {google && <GoogleSignInButton />}
      {microsoft && <MicrosoftSignInButton />}
    </>
  );
}
