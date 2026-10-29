import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 20 bytes = 160 bits = 32 base32 characters (no padding). */
const CODE_BYTES = 20;
const GROUP = 4;

/** Uppercase and strip hyphens and whitespace, so typing style never matters. */
export const normalizePilotCode = (code: string): string =>
  code.replace(/[\s-]+/g, '').toUpperCase();

/** Pilot codes are stored as sha256 hex of the normalized code; never compare or log plaintext. */
export const hashPilotCode = (code: string): string =>
  createHash('sha256').update(normalizePilotCode(code)).digest('hex');

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/** A fresh high-entropy pilot code (shown once) and the hash to store. */
export function generatePilotCode(): { code: string; codeHash: string } {
  const raw = base32(randomBytes(CODE_BYTES));
  const code = raw.match(new RegExp(`.{1,${GROUP}}`, 'g'))?.join('-') ?? raw;
  return { code, codeHash: hashPilotCode(code) };
}
