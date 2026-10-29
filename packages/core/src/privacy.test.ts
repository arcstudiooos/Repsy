import { describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_TEXT, PRIVACY_NOTICE_VERSION } from './privacy';

describe('privacy notice', () => {
  it('is versioned and has text', () => {
    expect(PRIVACY_NOTICE_VERSION).toBe('2026-10-29');
    expect(PRIVACY_NOTICE_TEXT.length).toBeGreaterThan(50);
  });
});
