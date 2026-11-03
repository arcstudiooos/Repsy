import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/tokens';
import { AVATAR_TONES, avatarTone, initials } from './avatar';

describe('avatar', () => {
  it('every tone keeps its initials readable', () => {
    for (const t of AVATAR_TONES) expect(contrastRatio(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('initials and tone are stable', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('client1@example.test')).toBe('CT');
    expect(initials('  ')).toBe('?');
    expect(avatarTone('Ada')).toBe(avatarTone('Ada'));
  });
});
