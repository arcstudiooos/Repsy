import { APIError } from 'better-auth/api';
import {
  DomainError,
  enforceAttemptLimit,
  hashPilotCode,
  logger,
  signupCoach,
  type SignupCoachInput,
} from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import type { Auth } from './auth';
import { hasCoachMembership } from './membership';
import { clientIp } from '../server/clientIp';

export const CODE_INVALID = 'This pilot code is invalid or has expired.';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  orgName: string;
  timezone: string;
  pilotCode: string;
}

export type RegisterResult = { ok: true } | { ok: false; fieldErrors: Record<string, string> };

type Redeem = (
  tx: Parameters<typeof signupCoach>[0],
  input: SignupCoachInput,
) => ReturnType<typeof signupCoach>;

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function pilotCodeUsable(prisma: PrismaClient, code: string): Promise<boolean> {
  const n = await withSystem(
    (tx) =>
      tx.pilotCode.count({
        where: { codeHash: hashPilotCode(code), usedAt: null, expiresAt: { gt: new Date() } },
      }),
    prisma,
  );
  return n === 1;
}

/** Undo a half-finished signup so the same email can register again. */
export async function deleteUser(prisma: PrismaClient, userId: string): Promise<void> {
  // The verification email is enqueued asynchronously and may land mid-delete; retry briefly.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await withSystem(async (tx) => {
        await tx.outboxEmail.deleteMany({ where: { toUserId: userId } });
        await tx.user.delete({ where: { id: userId } });
      }, prisma);
      return;
    } catch (error) {
      if (attempt === 3) {
        logger.error(
          { err: error instanceof Error ? error.message : 'unknown' },
          'signup compensation failed; user needs manual cleanup',
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

/**
 * The only way to create an account: pilot-code pre-check, Better Auth sign-up
 * (server-side call; HTTP sign-up is blocked), then signupCoach. If provisioning
 * fails after a real user exists, that user is deleted so a retry starts clean.
 */
export async function registerCoach(
  deps: { auth: Pick<Auth, 'api'>; prisma: PrismaClient; headers: Headers; redeem?: Redeem },
  input: RegisterInput,
): Promise<RegisterResult> {
  const { auth, prisma, headers } = deps;
  const redeem = deps.redeem ?? signupCoach;
  const { name, email, password, orgName, timezone, pilotCode } = input;

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = 'Enter your name.';
  if (!email) fieldErrors.email = 'Enter your email.';
  if (!orgName) fieldErrors.orgName = 'Enter your business name.';
  if (!validTimezone(timezone)) fieldErrors.timezone = 'Choose a valid time zone.';
  if (!pilotCode) fieldErrors.pilotCode = 'Enter your pilot code.';
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  try {
    await enforceAttemptLimit(prisma, [`ip:${clientIp(headers)}`, `email:${email.toLowerCase()}`]);
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, fieldErrors: { form: error.message } };
    throw error;
  }

  if (!(await pilotCodeUsable(prisma, pilotCode))) {
    return { ok: false, fieldErrors: { pilotCode: CODE_INVALID } };
  }

  let userId: string;
  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password, callbackURL: '/app' },
      headers,
    });
    userId = result.user.id;
  } catch (error) {
    if (error instanceof APIError) {
      const message = error.message || 'Could not create your account.';
      return {
        ok: false,
        fieldErrors: { [/password/i.test(message) ? 'password' : 'email']: message },
      };
    }
    throw error;
  }

  // Better Auth hides existing emails behind a synthetic user that is never stored.
  const stored = await withSystem(
    (tx) => tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma,
  );
  if (!stored) {
    logger.info('signup attempted for an already registered email');
    return { ok: true };
  }

  try {
    await withSystem((tx) => redeem(tx, { userId, pilotCode, orgName, timezone }), prisma);
  } catch (error) {
    await deleteUser(prisma, userId);
    if (error instanceof DomainError)
      return { ok: false, fieldErrors: { pilotCode: CODE_INVALID } };
    throw error;
  }
  return { ok: true };
}

/**
 * Recovery / Google path: a signed-in, verified user without a workspace
 * redeems a pilot code. Same rate limit as sign-up (per IP and per user).
 */
export async function redeemPilotCode(
  deps: { prisma: PrismaClient; headers: Headers; user: { id: string }; redeem?: Redeem },
  input: { pilotCode: string; orgName: string; timezone: string },
): Promise<{ orgId: string }> {
  const { prisma, headers, user } = deps;
  await enforceAttemptLimit(prisma, [`ip:${clientIp(headers)}`, `user:${user.id}`]);
  if (await hasCoachMembership(prisma, user.id)) {
    throw new DomainError('ALREADY_ONBOARDED', 'This account already has a workspace.');
  }
  const redeem = deps.redeem ?? signupCoach;
  return withSystem((tx) => redeem(tx, { userId: user.id, ...input }), prisma);
}
