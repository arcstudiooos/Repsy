import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail fast at boot on unsafe production auth config.
    (await import('@/lib/auth-env')).assertAuthEnv(process.env);
    // Production (or ENFORCE_RUNTIME_ROLE=true): refuse a superuser/BYPASSRLS/owner DB role.
    const { assertRuntimeRoleIfEnforced, prisma } = await import('@kinetic/db');
    await assertRuntimeRoleIfEnforced(prisma);
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

export const onRequestError = Sentry.captureRequestError;
