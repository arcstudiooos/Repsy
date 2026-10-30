import { describe, expect, it } from 'vitest';
import { isUuid, UUID } from './uuid';

describe('isUuid', () => {
  it('accepts canonical UUIDs in either case', () => {
    expect(isUuid('e0000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('E0000000-0000-4000-8000-00000000000A')).toBe(true);
    expect(UUID.test(crypto.randomUUID())).toBe(true);
  });
  it('rejects everything else', () => {
    for (const v of [
      '',
      'not-a-uuid',
      'e0000000-0000-4000-8000-00000000000',
      'e0000000000040008000000000000001',
      ' e0000000-0000-4000-8000-000000000001',
      42,
      null,
      undefined,
    ]) {
      expect(isUuid(v)).toBe(false);
    }
  });
});
