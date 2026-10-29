import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { enqueuePlatformEmail, logger } from '@kinetic/core';
import {
  authPrisma as defaultAuthPrisma,
  prisma as defaultPrisma,
  withSystem,
  type PrismaClient,
} from '@kinetic/db';

import { assertAuthEnv, type AuthEnv } from './auth-env';

export type { AuthEnv };

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
}

export const MIN_PASSWORD_LENGTH = 12;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const VERIFY_TTL_SECONDS = 60 * 60;
const RESET_TTL_SECONDS = 60 * 60;

/**
 * Breached-password check is ON everywhere. Only test/E2E env sets
 * DISABLE_BREACHED_PASSWORD_CHECK=true (they must not touch the network).
 */
export function breachedPasswordCheckEnabled(env: AuthEnv): boolean {
  return env.DISABLE_BREACHED_PASSWORD_CHECK !== 'true';
}

/** Never log or persist the link outside the outbox row: it carries a single-use token. */
function enqueueAuthEmail(
  prisma: PrismaClient,
  input: { userId: string; kind: string; token: string; subject: string; text: string },
): void {
  // Not awaited (Better Auth guidance): response timing must not reveal whether an account exists.
  void withSystem(
    (tx) =>
      enqueuePlatformEmail(tx, {
        kind: input.kind,
        toUserId: input.userId,
        templateKey: input.kind,
        payload: { subject: input.subject, text: input.text },
        idempotencyKey: `${input.kind}:${input.userId}:${input.token}`,
      }),
    prisma,
  ).catch((error: unknown) => {
    logger.error(
      { kind: input.kind, err: error instanceof Error ? error.message : 'unknown' },
      'failed to enqueue auth email',
    );
  });
}

export interface CreateAuthOptions {
  /** App/system client (outbox enqueue). */
  prisma?: PrismaClient;
  /**
   * Better Auth's own client: connections carry the users-RLS auth context
   * (createAuthPrismaClient). Required whenever `prisma` is injected.
   */
  authPrisma?: PrismaClient;
  env?: AuthEnv;
}

export function createAuth(options: CreateAuthOptions = {}) {
  const prisma = options.prisma ?? defaultPrisma;
  if (options.prisma && !options.authPrisma) {
    throw new Error('createAuth: pass authPrisma together with an injected prisma');
  }
  const authPrisma = options.authPrisma ?? defaultAuthPrisma;
  const env = options.env ?? process.env;
  assertAuthEnv(env);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(authPrisma, { provider: 'postgresql' }),
    advanced: {
      database: { generateId: 'uuid' },
      // Secure cookies whenever the configured origin is https.
      useSecureCookies: env.BETTER_AUTH_URL?.startsWith('https://') ?? false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    user: {
      additionalFields: {
        isPlatformAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
      },
    },
    // DB-backed sessions: a row per session, revocable by deleting it.
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 60 * 60 * 24 },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: RESET_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url, token }) => {
        enqueueAuthEmail(prisma, {
          userId: user.id,
          kind: 'auth.reset_password',
          token,
          subject: 'Reset your Kinetic password',
          text: `Use this link to choose a new password (valid for 1 hour): ${url}`,
        });
        return Promise.resolve();
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_TTL_SECONDS,
      sendVerificationEmail: ({ user, url, token }) => {
        enqueueAuthEmail(prisma, {
          userId: user.id,
          kind: 'auth.verify_email',
          token,
          subject: 'Verify your Kinetic email',
          text: `Confirm your email address to finish setting up your account: ${url}`,
        });
        return Promise.resolve();
      },
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'rateLimit', window: 60, max: 100 },
    ...(googleConfigured
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID as string,
              clientSecret: env.GOOGLE_CLIENT_SECRET as string,
              // Accounts are only created through pilot-code signup.
              disableImplicitSignUp: true,
            },
          },
        }
      : {}),
    hooks: {
      // Account creation is gated by a pilot code. registerCoach calls
      // auth.api.signUpEmail server-side (no ctx.request); anything arriving
      // over HTTP (ctx.request set) may not create users.
      before: createAuthMiddleware(async (ctx) => {
        const viaHttp = ctx.request !== undefined;
        const body = ctx.body as { requestSignUp?: unknown } | undefined;
        const blocked =
          ctx.path === '/sign-up/email' ||
          (ctx.path === '/sign-in/social' && body?.requestSignUp === true);
        if (viaHttp && blocked) {
          throw new APIError('FORBIDDEN', {
            message: 'Sign-up requires a pilot code.',
            code: 'SIGNUP_REQUIRES_PILOT_CODE',
          });
        }
      }),
    },
    plugins: breachedPasswordCheckEnabled(env) ? [haveIBeenPwned()] : [],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await authPrisma.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Lazily-built shared instance: env is read on first use, not at import/build time. */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    instance ??= createAuth();
    return Reflect.get(instance, prop, instance) as unknown;
  },
});

/** `instance` is injectable for tests; production code uses the shared `auth`. */
export async function getSessionUser(
  headers: Headers,
  instance: Pick<Auth, 'api'> = auth,
): Promise<SessionUser | null> {
  const session = await instance.api.getSession({ headers });
  if (!session) return null;
  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    isPlatformAdmin: user.isPlatformAdmin === true,
  };
}
