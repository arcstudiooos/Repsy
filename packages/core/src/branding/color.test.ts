import { describe, expect, it } from 'vitest';
import { accentProblem, contrastRatio, darken } from './color';

describe('brand colour checks (PRD A6)', () => {
  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#1c7666', '#ffffff')).toBeGreaterThan(4.5);
  });
  it('accepts dark accents and explains light ones', () => {
    expect(accentProblem('#1C7666')).toBeNull();
    expect(accentProblem('#ffcc00')).toMatch(/pick a darker colour/);
    expect(accentProblem('teal')).toBe('Use a colour like #1c7666.');
  });
  it('darkens for hover', () => {
    expect(darken('#808080', 0.5)).toBe('#404040');
  });
});
