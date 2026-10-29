export type AuthEnv = Record<string, string | undefined>;

const PLACEHOLDER = /replace|changeme|change-me|placeholder|your-|example/i;

/**
 * Production fail-fast: a missing origin lets Better Auth derive links from the
 * Host header, a weak secret breaks session signing, and the breached-password
 * check must never be switched off outside tests.
 */
export function assertAuthEnv(env: AuthEnv): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (!env.BETTER_AUTH_URL) problems.push('BETTER_AUTH_URL is required');
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || PLACEHOLDER.test(secret)) {
    problems.push('BETTER_AUTH_SECRET must be a random, non-placeholder value of 32+ characters');
  }
  if (env.DISABLE_BREACHED_PASSWORD_CHECK === 'true') {
    problems.push('DISABLE_BREACHED_PASSWORD_CHECK must not be true in production');
  }
  if (problems.length > 0) throw new Error(`Invalid auth configuration: ${problems.join('; ')}`);
}
