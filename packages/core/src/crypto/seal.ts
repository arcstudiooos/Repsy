import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * D-013 #1: provider tokens stored at rest (Razorpay OAuth, calendar OAuth) are sealed with AES-256-GCM under
 * `PROVIDER_TOKEN_KEY` (32 bytes, base64 or hex). The sealed form is `v1.<iv>.<tag>.<ciphertext>` in base64url; the
 * associated data binds it to its row's purpose, so a token sealed for one account can't be replayed into another.
 */
export function parseSealKey(raw: string | undefined): Buffer {
  const value = (raw ?? '').trim();
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('PROVIDER_TOKEN_KEY must be 32 bytes (64 hex or base64)');
  return key;
}

export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function unseal(key: Buffer, sealed: string, context: string): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('Malformed sealed value');
  const tagBytes = Buffer.from(tag, 'base64url');
  // Only full 16-byte tags: Node would accept truncated ones (security review F6).
  if (tagBytes.length !== 16) throw new Error('Malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
