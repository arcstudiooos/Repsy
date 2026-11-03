import { describe, expect, it } from 'vitest';
import { parseSealKey, seal, unseal } from './seal';

const key = parseSealKey('a'.repeat(64));

describe('seal (D-013 #1)', () => {
  it('round-trips, and refuses another context, a tampered value or a wrong key', () => {
    const s = seal(key, 'token-123', 'razorpay:acc_1');
    expect(s.startsWith('v1.')).toBe(true);
    expect(unseal(key, s, 'razorpay:acc_1')).toBe('token-123');
    expect(() => unseal(key, s, 'razorpay:acc_2')).toThrow();
    // A truncated tag is refused, not accepted as a weaker check.
    const [v, iv, tag, body] = s.split('.') as [string, string, string, string];
    const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => unseal(key, [v, iv, short, body].join('.'), 'razorpay:acc_1')).toThrow();
    const parts = s.split('.');
    parts[3] = Buffer.from('x').toString('base64url');
    expect(() => unseal(key, parts.join('.'), 'razorpay:acc_1')).toThrow();
    expect(() => unseal(parseSealKey('b'.repeat(64)), s, 'razorpay:acc_1')).toThrow();
    expect(() => parseSealKey('short')).toThrow(/32 bytes/);
  });
});
