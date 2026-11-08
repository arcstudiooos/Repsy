import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { twoFactor } from 'better-auth/plugins/two-factor';
import {
  enqueuePlatformEmail,
  logger,
  microsoftLinkAllowed,
  microsoftTenantFromIdToken,
  ssoRequiredFor,
} from '@kinetic/core';
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
  input: {
    userId: string;
    kind: string;
    token: string;
    subject: string;
    text: string;
    /** The action link; the worker renders it as the email's button. */
    url: string;
    name?: string;
  },
): void {
  // Not awaited (Better Auth guidance): response timing must not reveal whether an account exists.
  void withSystem(
    (tx) =>
      enqueuePlatformEmail(tx, {
        kind: input.kind,
        toUserId: input.userId,
        templateKey: input.kind,
        payload: {
          subject: input.subject,
          text: input.text,
          url: input.url,
          ...(input.name ? { name: input.name } : {}),
        },
        // Hash of the token: the key is kept forever (unique index), the token must not be.
        idempotencyKey: `${input.kind}:${input.userId}:${createHash('sha256').update(input.token).digest('hex')}`,
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
  const microsoftConfigured = microsoftSsoConfigured(env);

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
          subject: 'Reset your Repsy password',
          text: `Use this link to choose a new password (valid for 1 hour): ${url}`,
          url,
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
          subject: 'Verify your Repsy email',
          text: `Confirm your email address to finish setting up your account: ${url}`,
          url,
          name: user.name,
        });
        return Promise.resolve();
      },
    },
    rateLimit: { enabled: true, storage: 'database', modelName: 'rateLimit', window: 60, max: 100 },
    // Absent entirely when no provider is configured.
    ...(googleConfigured || microsoftConfigured
      ? {
          socialProviders: {
            ...(googleConfigured
              ? {
                  google: {
                    clientId: env.GOOGLE_CLIENT_ID as string,
                    clientSecret: env.GOOGLE_CLIENT_SECRET as string,
                    // Signing in never creates an account. The sign-up page's Google button asks for one
                    // explicitly (requestSignUp); the new user then sets up a workspace at onboarding.
                    disableImplicitSignUp: true,
                  },
                }
              : {}),
            // PRD A16: Microsoft Entra ID single sign-on for work accounts. Never creates accounts.
            ...(microsoftConfigured
              ? {
                  microsoft: {
                    clientId: env.MICROSOFT_CLIENT_ID as string,
                    clientSecret: env.MICROSOFT_CLIENT_SECRET as string,
                    tenantId: 'organizations',
                    disableImplicitSignUp: true,
                    disableProfilePhoto: true,
                  },
                }
              : {}),
          },
        }
      : {}),
    account: {
      // SSO signs an invited team member into their existing account. Microsoft's email claim is not
      // verified, so each Microsoft link is checked against the workspace's directory below.
      accountLinking: { enabled: true, trustedProviders: ['google', 'microsoft'] },
    },
    hooks: {
      // Password accounts are created only by registerCoach, which calls auth.api.signUpEmail
      // server-side (no ctx.request). Over HTTP (ctx.request set) the only sign-up allowed is
      // Google's, from the sign-up page: Google has verified the email, and a user with no
      // workspace is sent to /onboarding to create one. Microsoft SSO never creates users.
      before: createAuthMiddleware(async (ctx) => {
        const viaHttp = ctx.request !== undefined;
        const body = ctx.body as { requestSignUp?: unknown; provider?: unknown } | undefined;
        const blocked =
          ctx.path === '/sign-up/email' ||
          (ctx.path === '/sign-in/social' &&
            body?.requestSignUp === true &&
            body.provider !== 'google');
        if (viaHttp && blocked) {
          throw new APIError('FORBIDDEN', {
            message: 'Create your account on the Repsy sign-up page.',
            code: 'SIGNUP_ON_SIGNUP_PAGE',
          });
        }
        // PRD A16: a workspace that requires single sign-on blocks password sign-in for its staff.
        if (viaHttp && ctx.path === '/sign-in/email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          const provider = typeof email === 'string' ? await ssoRequiredFor(prisma, email) : null;
          if (provider) {
            throw new APIError('FORBIDDEN', {
              message: `Your workspace uses single sign-on. Continue with ${provider === 'google' ? 'Google' : 'Microsoft'} instead.`,
              code: 'SSO_REQUIRED',
            });
          }
        }
      }),
    },
    plugins: [
      ...(breachedPasswordCheckEnabled(env) ? [haveIBeenPwned()] : []),
      // PRD A8: an authenticator app code (or a one-time backup code) after the password.
      twoFactor({ issuer: 'Repsy' }),
    ],
    databaseHooks: {
      account: {
        create: {
          // PRD A16: a Microsoft account links only from the workspace's own Entra directory.
          before: async (account) => {
            if (account.providerId !== 'microsoft') return;
            const tenantId = microsoftTenantFromIdToken(account.idToken);
            const allowed = await microsoftLinkAllowed(prisma, account.userId, tenantId);
            if (!allowed) {
              logger.warn(
                { userId: account.userId },
                'microsoft sign-in refused: directory mismatch',
              );
              return false;
            }
          },
        },
      },
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

/** Microsoft SSO needs an Entra app registration (multi-tenant, work accounts). */
export function microsoftSsoConfigured(env: AuthEnv = process.env): boolean {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
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
