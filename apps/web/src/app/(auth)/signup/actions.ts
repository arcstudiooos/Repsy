'use server';

import { APIError } from 'better-auth/api';
import { redirect } from 'next/navigation';
import { DomainError, hashPilotCode, logger, signupCoach } from '@kinetic/core';
import { withSystem } from '@kinetic/db';
import { auth } from '@/lib/auth';

export interface SignupState {
  fieldErrors?: Record<string, string>;
}

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const CODE_INVALID = 'This pilot code is invalid or has expired.';

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Coach signup: pilot code pre-check, Better Auth sign-up, then signupCoach in
 * one system transaction. The user id comes from the sign-up result, never the client.
 */
export async function signUpCoachAction(_prev: SignupState, data: FormData): Promise<SignupState> {
  const name = field(data, 'name');
  const email = field(data, 'email');
  const password = String(data.get('password') ?? '');
  const orgName = field(data, 'orgName');
  const timezone = field(data, 'timezone');
  const pilotCode = field(data, 'pilotCode');

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = 'Enter your name.';
  if (!email) fieldErrors.email = 'Enter your email.';
  if (!orgName) fieldErrors.orgName = 'Enter your business name.';
  if (!validTimezone(timezone)) fieldErrors.timezone = 'Choose a valid time zone.';
  if (!pilotCode) fieldErrors.pilotCode = 'Enter your pilot code.';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Fail before creating a user when the code is already unusable.
  const usable = await withSystem((tx) =>
    tx.pilotCode.count({
      where: { codeHash: hashPilotCode(pilotCode), usedAt: null, expiresAt: { gt: new Date() } },
    }),
  );
  if (usable !== 1) return { fieldErrors: { pilotCode: CODE_INVALID } };

  let userId: string;
  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password, callbackURL: '/app' },
    });
    userId = result.user.id;
  } catch (error) {
    if (error instanceof APIError) {
      const message = error.message || 'Could not create your account.';
      return { fieldErrors: { [/password/i.test(message) ? 'password' : 'email']: message } };
    }
    throw error;
  }

  try {
    await withSystem((tx) => signupCoach(tx, { userId, pilotCode, orgName, timezone }));
  } catch (error) {
    if (error instanceof DomainError) return { fieldErrors: { pilotCode: CODE_INVALID } };
    // Existing email: Better Auth answers with a synthetic user (no enumeration),
    // so the FK to users fails. Fall through to the same neutral "check your email" page.
    if ((error as { code?: string }).code !== 'P2003') throw error;
    logger.info('signup attempted for an already registered email');
  }
  redirect('/verify-email');
}
