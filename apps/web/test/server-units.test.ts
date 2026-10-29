import { describe, expect, it } from 'vitest';
import { signOrgCookie, verifyOrgCookie, readCookie } from '@/server/orgCookie';
import { InMemoryRateLimiter } from '@/server/rateLimit';

describe('org cookie', () => {
  const secret = 'k'.repeat(32);
  it('verifies for the same user, rejects other user, tamper, garbage', () => {
    const v = signOrgCookie('u1', 'o1', secret);
    expect(verifyOrgCookie(v, 'u1', secret)).toBe('o1');
    expect(verifyOrgCookie(v, 'u2', secret)).toBeNull();
    expect(verifyOrgCookie(v, 'u1', 'x'.repeat(32))).toBeNull();
    expect(verifyOrgCookie(v.replace('o1', 'o2'), 'u1', secret)).toBeNull();
    expect(verifyOrgCookie('o1.zz', 'u1', secret)).toBeNull();
    expect(verifyOrgCookie('nodot', 'u1', secret)).toBeNull();
  });
  it('parses cookie headers', () => {
    expect(readCookie('a=1; kinetic_org=abc', 'kinetic_org')).toBe('abc');
    expect(readCookie(null, 'x')).toBeUndefined();
  });
});

describe('InMemoryRateLimiter', () => {
  it('refills over time', () => {
    let now = 0;
    const l = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    expect(l.consume('k').allowed).toBe(true);
    const denied = l.consume('k');
    expect(denied).toEqual({ allowed: false, retryAfterMs: 1000 });
    now = 1000;
    expect(l.consume('k').allowed).toBe(true);
  });
});
