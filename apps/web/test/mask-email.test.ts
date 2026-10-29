import { describe, expect, it } from 'vitest';
import { maskEmail } from '@/lib/mask-email';

describe('maskEmail', () => {
  it.each([
    ['ann.smith@example.com', 'a********@example.com'],
    ['bo@example.com', 'b*@example.com'],
    ['x@example.com', 'x@example.com'],
    ['not-an-email', '***'],
  ])('%s -> %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});
