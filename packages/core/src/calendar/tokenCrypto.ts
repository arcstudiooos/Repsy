import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * PRD K10: provider refresh tokens are stored as AES-256-GCM ciphertext. The key is
 * CALENDAR_TOKEN_KEY (any long random string) or, when unset, derived from BETTER_AUTH_SECRET, so a
 * database dump alone never reveals a token. Format: v1.<iv>.<tag>.<ciphertext>, base64url parts.
 */
function keyFrom(env: Record<string, string | undefined>): Buffer {
  const secret = env.CALENDAR_TOKEN_KEY || env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'CALENDAR_TOKEN_KEY or BETTER_AUTH_SECRET must be set to store calendar tokens.',
    );
  }
  return createHash('sha256').update(`repsy-calendar-token:${secret}`).digest();
}

export function encryptToken(
  plain: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(env), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

export function decryptToken(
  sealed: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable calendar token.');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(env), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
