import { APIError } from 'better-auth/api';
import {
  acceptInvite,
  classifyInvite,
  DomainError,
  enforceAttemptLimit,
  GOALS_MAX,
  hashInviteToken,
  inviteFailureMessage,
  isIanaTimezone,
  PRIVACY_NOTICE_VERSION,
  type ErrorCode,
} from '@kinetic/core';
import { findInviteByTokenHash, withSystem, type PrismaClient } from '@kinetic/db';
import { MIN_PASSWORD_LENGTH, type Auth } from './auth';
import { deleteUser } from './register-coach';
import { clientIp } from '../server/clientIp';

export interface OnboardingInput {
  token: string;
  consent: boolean;
  timezone: string;
  preferredUnits: 'kg' | 'lb';
  goals?: string;
}

export type AcceptWithSignupResult =
  | { ok: true; orgId: string; setCookies: string[] }
  | { ok: false; code?: ErrorCode; fieldErrors: Record<string, string> };

const CONSENT_REQUIRED = 'Agree to share your training data to continue.';
const ACCOUNT_EXISTS = 'An account already exists for this email. Sign in to accept this invite.';

/** Field checks shared by the signed-out form; core re-validates inside acceptInvite. */
function validateFields(input: OnboardingInput & { password?: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.password !== undefined && input.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!input.consent) errors.consent = CONSENT_REQUIRED;
  if (!isIanaTimezone(input.timezone)) errors.timezone = 'Choose a valid time zone.';
  if (input.preferredUnits !== 'kg' && input.preferredUnits !== 'lb') {
    errors.preferredUnits = 'Choose kg or lb.';
  }
  if ((input.goals ?? '').trim().length > GOALS_MAX) {
    errors.goals = `Use at most ${GOALS_MAX} characters.`;
  }
  return errors;
}

const failure = (error: DomainError): AcceptWithSignupResult => {
  const flat = Object.fromEntries(
    Object.entries(error.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? error.message]),
  );
  return {
    ok: false,
    code: error.code,
    fieldErrors: Object.keys(flat).length > 0 ? flat : { form: error.message },
  };
};

/**
 * Signed-out acceptance: the invite token proves the invitee controls the
 * mailbox, so the account is created already verified. Order matters: validate,
 * rate limit (per IP and per token), check the invite, create the user
 * (server-side call; HTTP sign-up is blocked), accept, then sign in. A failure
 * after the user exists deletes that user so a retry starts clean.
 */
export async function acceptWithSignup(
  deps: { auth: Pick<Auth, 'api'>; prisma: PrismaClient; headers: Headers },
  input: OnboardingInput & { password: string },
): Promise<AcceptWithSignupResult> {
  const { auth, prisma, headers } = deps;
  const fieldErrors = validateFields(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const tokenHash = hashInviteToken(input.token);
  try {
    await enforceAttemptLimit(prisma, [`ip:${clientIp(headers)}`, `invite:${tokenHash}`]);
  } catch (error) {
    if (error instanceof DomainError) return failure(error);
    throw error;
  }

  const lookup = await findInviteByTokenHash(tokenHash, prisma);
  const state = classifyInvite(lookup, new Date());
  if (state !== 'ok' || !lookup) {
    const code = state === 'ok' ? 'INVITE_INVALID' : state;
    return { ok: false, code, fieldErrors: { form: inviteFailureMessage(code) } };
  }

  let userId: string;
  try {
    const created = await auth.api.signUpEmail({
      body: { name: lookup.clientName, email: lookup.email, password: input.password },
      headers,
    });
    userId = created.user.id;
  } catch (error) {
    if (error instanceof APIError) {
      const message = error.message || 'Could not create your account.';
      return {
        ok: false,
        fieldErrors: { [/password/i.test(message) ? 'password' : 'form']: message },
      };
    }
    throw error;
  }

  // Better Auth hides existing emails behind a synthetic user that is never stored.
  const stored = await withSystem(
    (tx) => tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma,
  );
  if (!stored) return { ok: false, fieldErrors: { form: ACCOUNT_EXISTS } };

  try {
    await withSystem(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { emailVerified: true } });
      // Sign-up queued a verification mail; the invite already proved the mailbox.
      await tx.outboxEmail.deleteMany({
        where: { toUserId: userId, kind: 'auth.verify_email', status: 'pending' },
      });
    }, prisma);
    const { orgId } = await acceptInvite(
      {
        tokenHash,
        userId,
        consentVersion: PRIVACY_NOTICE_VERSION,
        timezone: input.timezone,
        preferredUnits: input.preferredUnits,
        goals: input.goals,
      },
      new Date(),
      prisma,
    );

    let setCookies: string[] = [];
    try {
      const session = await auth.api.signInEmail({
        body: { email: lookup.email, password: input.password },
        headers,
        returnHeaders: true,
      });
      setCookies = session.headers.getSetCookie();
    } catch {
      // Account and membership exist; the caller sends the user to /login instead.
    }
    return { ok: true, orgId, setCookies };
  } catch (error) {
    await deleteUser(prisma, userId);
    if (error instanceof DomainError) return failure(error);
    throw error;
  }
}

/**
 * Signed-in acceptance (POST /api/v1/auth/invite/accept). The session email
 * must match the invite email (case-insensitive). Rate limited per user and
 * per token hash (the IP is shared by everyone behind one NAT).
 */
export async function acceptSignedIn(
  deps: { prisma: PrismaClient },
  user: { id: string; email: string },
  input: OnboardingInput,
): Promise<{ orgId: string; clientId: string }> {
  const { prisma } = deps;
  const tokenHash = hashInviteToken(input.token);
  await enforceAttemptLimit(prisma, [`user:${user.id}`, `invite:${tokenHash}`]);

  const lookup = await findInviteByTokenHash(tokenHash, prisma);
  const state = classifyInvite(lookup, new Date());
  if (state !== 'ok' || !lookup) {
    const code = state === 'ok' ? 'INVITE_INVALID' : state;
    throw new DomainError(code, inviteFailureMessage(code));
  }
  if (lookup.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new DomainError('FORBIDDEN', 'This invite was sent to a different email address.');
  }
  return acceptInvite(
    {
      tokenHash,
      userId: user.id,
      consentVersion: PRIVACY_NOTICE_VERSION,
      timezone: input.timezone,
      preferredUnits: input.preferredUnits,
      goals: input.goals,
    },
    new Date(),
    prisma,
  );
}
