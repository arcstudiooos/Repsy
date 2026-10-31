import { createHmac, timingSafeEqual } from 'node:crypto';

/** S5-2: download links are valid for 15 minutes and bound to the requesting user. */
export const LINK_TTL_MS = 15 * 60_000;

type Env = Record<string, string | undefined>;

function secretOf(env: Env): string {
  const s = env.EXPORT_LINK_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim();
  if (!s) throw new Error('EXPORT_LINK_SECRET or BETTER_AUTH_SECRET is required');
  return s;
}

interface Claims {
  j: string;
  f: string;
  u: string;
  e: number;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function signExportLink(
  claims: { jobId: string; file: string; userId: string },
  now: number,
  env: Env = process.env,
): { token: string; expiresAt: number } {
  const e = now + LINK_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ j: claims.jobId, f: claims.file, u: claims.userId, e } satisfies Claims),
  ).toString('base64url');
  return { token: `${payload}.${sign(payload, secretOf(env))}`, expiresAt: e };
}

export type LinkCheck = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'other_user' };

/** Verifies a link token for this job, file and signed-in user. */
export function verifyExportLink(
  token: string,
  expected: { jobId: string; file: string; userId: string },
  now: number,
  env: Env = process.env,
): LinkCheck {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { ok: false, reason: 'invalid' };
  const good = Buffer.from(sign(payload, secretOf(env)));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) {
    return { ok: false, reason: 'invalid' };
  }
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (claims.j !== expected.jobId || claims.f !== expected.file)
    return { ok: false, reason: 'invalid' };
  if (claims.e <= now) return { ok: false, reason: 'expired' };
  if (claims.u !== expected.userId) return { ok: false, reason: 'other_user' };
  return { ok: true };
}
