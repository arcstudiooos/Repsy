import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '@repsy/core';
import type { PrismaClient } from '@repsy/db';
import { withPlatformAdmin } from '@/server/platformAdmin';

/** A client whose `$transaction` records calls and hands `withSystem` a tx that accepts `$executeRaw`. */
function fakeClient() {
  const tx = { $executeRaw: vi.fn(async () => 1) };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return { client: { $transaction } as unknown as PrismaClient, $transaction, tx };
}

describe('withPlatformAdmin (PR #2 review I1)', () => {
  it('refuses a non-admin with NOT_FOUND before opening any transaction', async () => {
    for (const user of [
      null,
      undefined,
      { id: 'u1', isPlatformAdmin: false },
      { id: 'u1' } as { id: string; isPlatformAdmin: boolean },
    ]) {
      const { client, $transaction } = fakeClient();
      const fn = vi.fn(async () => 'data');
      const err = await withPlatformAdmin(user, fn, client).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('NOT_FOUND');
      expect($transaction).not.toHaveBeenCalled();
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('runs fn in system scope for a platform admin, with the admin identity', async () => {
    const { client, $transaction, tx } = fakeClient();
    const fn = vi.fn(async () => 'data');
    expect(await withPlatformAdmin({ id: 'a1', isPlatformAdmin: true }, fn, client)).toBe('data');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(tx, { userId: 'a1', isPlatformAdmin: true });
  });
});

// Every web module that opens system scope (RLS bypass) on a request path. Each one must be listed, with its
// justification, in the `withSystem` doc comment of packages/db/src/tenant.ts (the token is what the doc names).
const WITH_SYSTEM_ALLOWED: Record<string, string> = {
  'app/select-org/page.tsx': 'web app/select-org',
  'lib/accept-invite.ts': 'web lib/accept-invite.ts',
  'lib/auth.ts': 'lib/auth.ts',
  'lib/membership.ts': 'web lib/membership.ts',
  'lib/register-coach.ts': 'web lib/register-coach.ts',
  'server/actor.ts': 'web server/actor.ts',
  'server/platformAdmin.ts': 'web server/platformAdmin.ts',
  'server/routes/push.ts': 'web server/routes/push.ts',
};
// The platform-admin console reaches system scope only through `withPlatformAdmin`.
const WITH_PLATFORM_ADMIN_ALLOWED: Record<string, string> = {
  'server/routes/privacy.ts': 'web server/routes/privacy.ts',
  'server/routes/lapse.ts': 'web server/routes/lapse.ts',
  'app/admin/page.tsx': 'web app/admin/page.tsx',
  'app/admin/support/[clientId]/page.tsx': 'web app/admin/support/[clientId]/page.tsx',
};

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const TENANT_TS = fileURLToPath(new URL('../../../packages/db/src/tenant.ts', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}
const callers = (name: string) =>
  sources(SRC)
    .filter((f) => new RegExp(`\\b${name}\\s*[(<]`).test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f).split(sep).join('/'))
    .filter((f) => !(name === 'withPlatformAdmin' && f === 'server/platformAdmin.ts'))
    .sort();

describe('request-path system scope inventory (PR #2 review I1)', () => {
  const doc = readFileSync(TENANT_TS, 'utf8');

  it('only the sanctioned web modules call withSystem, and each is in the tenant.ts inventory', () => {
    expect(callers('withSystem')).toEqual(Object.keys(WITH_SYSTEM_ALLOWED).sort());
    for (const token of Object.values(WITH_SYSTEM_ALLOWED))
      expect(doc.includes(token), token).toBe(true);
  });

  it('only the admin console calls withPlatformAdmin, and each caller is in the tenant.ts inventory', () => {
    expect(callers('withPlatformAdmin')).toEqual(Object.keys(WITH_PLATFORM_ADMIN_ALLOWED).sort());
    for (const token of Object.values(WITH_PLATFORM_ADMIN_ALLOWED)) {
      expect(doc.includes(token), token).toBe(true);
    }
  });
});
