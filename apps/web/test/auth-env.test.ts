import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createAuth } from '@/lib/auth';
import { assertAuthEnv } from '@/lib/auth-env';

const good = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://app.example.test',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
};

describe('production auth env', () => {
  it('accepts a complete production env', () => {
    expect(() => assertAuthEnv(good)).not.toThrow();
  });

  it.each([
    ['missing BETTER_AUTH_URL', { BETTER_AUTH_URL: undefined }, /BETTER_AUTH_URL/],
    ['missing secret', { BETTER_AUTH_SECRET: undefined }, /BETTER_AUTH_SECRET/],
    ['short secret', { BETTER_AUTH_SECRET: 'short' }, /BETTER_AUTH_SECRET/],
    [
      'placeholder secret',
      { BETTER_AUTH_SECRET: 'replace-with-random-32-char-secret-value' },
      /BETTER_AUTH_SECRET/,
    ],
    [
      'breached check disabled',
      { DISABLE_BREACHED_PASSWORD_CHECK: 'true' },
      /DISABLE_BREACHED_PASSWORD_CHECK/,
    ],
  ])('createAuth throws in production: %s', (_name, patch, message) => {
    const env = { ...good, ...patch };
    expect(() =>
      createAuth({ prisma: {} as PrismaClient, authPrisma: {} as PrismaClient, env }),
    ).toThrow(message);
  });

  it('requires the Better Auth client whenever prisma is injected', () => {
    expect(() => createAuth({ prisma: {} as PrismaClient, env: good })).toThrow(/authPrisma/);
  });

  it('does not enforce outside production', () => {
    expect(() =>
      assertAuthEnv({ NODE_ENV: 'development', DISABLE_BREACHED_PASSWORD_CHECK: 'true' }),
    ).not.toThrow();
  });
});
