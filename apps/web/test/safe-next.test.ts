import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

const origin = 'http://localhost:3000';

describe('safeNext', () => {
  it.each([
    ['/\\evil.com', '/app'],
    ['//evil.com', '/app'],
    ['https://evil.com', '/app'],
    ['javascript:alert(1)', '/app'],
    ['/app/clients?x=1', '/app/clients?x=1'],
    ['http://localhost:3000/settings', '/settings'],
    [null, '/app'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input, origin)).toBe(expected);
  });
});
