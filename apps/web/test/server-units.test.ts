import { describe, expect, it } from 'vitest';
import { clientIp } from '@/server/clientIp';
import { orgCookieSecret, signOrgCookie, verifyOrgCookie, readCookie } from '@/server/orgCookie';
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

describe('orgCookieSecret', () => {
  it('empty ORG_COOKIE_SECRET falls back to BETTER_AUTH_SECRET', () => {
    expect(orgCookieSecret({ ORG_COOKIE_SECRET: '  ', BETTER_AUTH_SECRET: 'abc' })).toBe('abc');
    expect(orgCookieSecret({ ORG_COOKIE_SECRET: '', BETTER_AUTH_SECRET: 'abc' })).toBe('abc');
  });
  it('throws when nothing is set, or when short in production', () => {
    expect(() => orgCookieSecret({ ORG_COOKIE_SECRET: '' })).toThrow();
    expect(() =>
      orgCookieSecret({ BETTER_AUTH_SECRET: 'short', NODE_ENV: 'production' }),
    ).toThrow();
    expect(orgCookieSecret({ BETTER_AUTH_SECRET: 'x'.repeat(32), NODE_ENV: 'production' })).toBe(
      'x'.repeat(32),
    );
  });
});

describe('clientIp', () => {
  const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});
  it('spoofed leftmost values with the same last hop agree', () => {
    expect(clientIp(h('1.1.1.1, 9.9.9.9'), 1)).toBe('9.9.9.9');
    expect(clientIp(h('2.2.2.2, 3.3.3.3, 9.9.9.9'), 1)).toBe('9.9.9.9');
  });
  it('hops=2 picks second-to-last', () => {
    expect(clientIp(h('1.1.1.1, 8.8.8.8, 9.9.9.9'), 2)).toBe('8.8.8.8');
  });
  it('absent or too short -> unknown', () => {
    expect(clientIp(h(), 1)).toBe('unknown');
    expect(clientIp(h('9.9.9.9'), 2)).toBe('unknown');
    expect(clientIp(h('9.9.9.9'), 0)).toBe('unknown');
  });
});

describe('InMemoryRateLimiter isolation', () => {
  it('flooding ip buckets does not reset a user bucket', () => {
    const l = new InMemoryRateLimiter({ capacity: 1, refillPerSecond: 0.0001, now: () => 0 });
    expect(l.consume('user:u').allowed).toBe(true);
    for (let i = 0; i < 10_500; i++) l.consume(`ip:${i}`);
    expect(l.consume('user:u').allowed).toBe(false);
  });
});
