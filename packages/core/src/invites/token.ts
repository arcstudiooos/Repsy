import { createHash, randomBytes } from 'node:crypto';

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** 32 random bytes = 256 bits, base64url (43 chars). Only the sha256 hex hash is stored. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}
