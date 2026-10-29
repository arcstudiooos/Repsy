import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-next';

const origin = 'http://localhost:3000';

describe('safeNext', () => {
  it.each([
    ['/\\evil.com', '/'],
    ['//evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/app/clients?x=1', '/app/clients?x=1'],
    ['http://localhost:3000/settings', '/settings'],
    [null, '/'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input, origin)).toBe(expected);
  });
});
