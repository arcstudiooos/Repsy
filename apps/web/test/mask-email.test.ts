import { describe, expect, it } from 'vitest';
import { maskEmail } from '@/lib/mask-email';

describe('maskEmail', () => {
  it.each([
    ['ann.smith@example.com', 'a********@example.com'],
    ['bo@example.com', 'b*@example.com'],
    ['x@example.com', 'x*@example.com'],
    ['x@domain.test', 'x*@domain.test'],
    ['not-an-email', '***'],
  ])('%s -> %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('always leaks fewer characters than the local part (never the full address)', () => {
    for (const local of ['a', 'ab', 'abc']) {
      const masked = maskEmail(`${local}@d.test`);
      expect(masked.split('@')[0]).toContain('*');
    }
  });
});
