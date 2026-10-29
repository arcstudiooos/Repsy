import { createHmac, timingSafeEqual } from 'node:crypto';

export const ORG_COOKIE = 'kinetic_org';

/**
 * Signing key: ORG_COOKIE_SECRET when set, otherwise BETTER_AUTH_SECRET (already
 * required to be strong in production). The HMAC covers userId AND orgId, so a
 * cookie copied to another user's browser verifies as absent. Membership is
 * still re-checked on every request; the signature only proves the server
 * chose this org for this user, it never grants access.
 */
export function orgCookieSecret(env: Record<string, string | undefined> = process.env): string {
  // Empty/whitespace counts as unset (.env.example ships `ORG_COOKIE_SECRET=`).
  const secret = env.ORG_COOKIE_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim();
  if (!secret) throw new Error('ORG_COOKIE_SECRET or BETTER_AUTH_SECRET is required');
  if (env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error(
      'ORG_COOKIE_SECRET (or BETTER_AUTH_SECRET) must be 32+ characters in production',
    );
  }
  return secret;
}

const mac = (secret: string, userId: string, orgId: string): string =>
  createHmac('sha256', secret).update(`${userId}:${orgId}`).digest('hex');

export function signOrgCookie(userId: string, orgId: string, secret: string): string {
  return `${orgId}.${mac(secret, userId, orgId)}`;
}

/** Returns the org id when the signature is valid for this user, otherwise null (treated as absent). */
export function verifyOrgCookie(value: string, userId: string, secret: string): string | null {
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const orgId = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'hex');
  const expected = Buffer.from(mac(secret, userId, orgId), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? orgId : null;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Set-Cookie value for the org switcher. */
export function serializeOrgCookie(
  userId: string,
  orgId: string,
  secret: string,
  secure: boolean,
): string {
  const value = signOrgCookie(userId, orgId, secret);
  return `${ORG_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? '; Secure' : ''}`;
}
