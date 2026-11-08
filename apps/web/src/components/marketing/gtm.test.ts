import { describe, expect, it } from 'vitest';
import { gtmContainerId } from './gtm';

describe('gtmContainerId', () => {
  it('returns a trimmed GTM container id', () => {
    expect(gtmContainerId({ NEXT_PUBLIC_GTM_ID: ' GTM-MBTTWJPC ' })).toBe('GTM-MBTTWJPC');
  });

  it('treats a missing or malformed value as off', () => {
    expect(gtmContainerId({})).toBe('');
    expect(gtmContainerId({ NEXT_PUBLIC_GTM_ID: 'G-12345' })).toBe('');
    expect(gtmContainerId({ NEXT_PUBLIC_GTM_ID: 'GTM-X"><script>' })).toBe('');
  });
});
