'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { prisma } from '@repsy/db';
import { acceptWithSignup } from '@/lib/accept-invite';
import { auth, getSessionUser } from '@/lib/auth';

export interface AcceptState {
  fieldErrors?: Record<string, string>;
}

const text = (data: FormData, key: string) => String(data.get(key) ?? '');

/**
 * Signed-out acceptance: creates the (verified) account, accepts the invite,
 * signs the user in and lands them in the portal. Nothing identity-related
 * comes from the form except the password: the email and name are the invite's.
 */
export async function acceptWithSignupAction(
  _prev: AcceptState,
  data: FormData,
): Promise<AcceptState> {
  const requestHeaders = await headers();
  // A signed-in visitor must not be silently swapped into a new account.
  if (await getSessionUser(requestHeaders)) {
    return {
      fieldErrors: {
        form: "You're signed in. Sign out to accept this invite with a new account.",
      },
    };
  }
  const units = text(data, 'preferredUnits');
  const result = await acceptWithSignup(
    { auth, prisma, headers: requestHeaders },
    {
      token: text(data, 'token'),
      password: text(data, 'password'),
      consent: data.get('consent') === 'on',
      timezone: text(data, 'timezone').trim(),
      preferredUnits: units === 'lb' ? 'lb' : 'kg',
      goals: text(data, 'goals'),
    },
  );
  if (!result.ok) return { fieldErrors: result.fieldErrors };

  const jar = await cookies();
  for (const header of result.setCookies) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      jar.set(name, attributes.value, toCookieOptions(attributes));
    }
  }
  redirect(result.setCookies.length > 0 ? '/portal' : '/login');
}
