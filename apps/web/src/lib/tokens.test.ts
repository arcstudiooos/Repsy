import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, tokens } from './tokens';

describe('design tokens', () => {
  it('contrastRatio matches known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('warning meets AA on surface', () => {
    expect(contrastRatio(tokens.warning, tokens.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('input border meets 3:1 on surface and canvas', () => {
    expect(contrastRatio(tokens.inputBorder, tokens.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.inputBorder, tokens.canvas)).toBeGreaterThanOrEqual(3);
  });

  it('primary ink and secondary text meet 4.5:1 on canvas', () => {
    expect(contrastRatio(tokens.ink, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.secondary, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent, accent hover and danger meet AA against white text/surface', () => {
    expect(contrastRatio('#FFFFFF', tokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', tokens.accentHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.danger, tokens.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('the newer state colours stay readable (accent ink on its tint, success, secondary on a well)', () => {
    expect(contrastRatio(tokens.accentInk, tokens.accentSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.success, tokens.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.secondary, tokens.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.ink, tokens.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
  });

  it('tokens.css mirrors tokens.ts', () => {
    const css = readFileSync(
      new URL('../styles/tokens.css', import.meta.url),
      'utf8',
    ).toLowerCase();
    const pairs: Array<[string, string]> = [
      ['--k-canvas', tokens.canvas],
      ['--k-surface', tokens.surface],
      ['--k-ink', tokens.ink],
      ['--k-accent', tokens.accent],
      ['--k-accent-hover', tokens.accentHover],
      ['--k-secondary', tokens.secondary],
      ['--k-divider', tokens.divider],
      ['--k-input-border', tokens.inputBorder],
      ['--k-warning', tokens.warning],
      ['--k-danger', tokens.danger],
      ['--k-surface-muted', tokens.surfaceMuted],
      ['--k-accent-soft', tokens.accentSoft],
      ['--k-accent-ink', tokens.accentInk],
      ['--k-border', tokens.border],
      ['--k-success', tokens.success],
    ];
    for (const [name, hex] of pairs) expect(css).toContain(`${name}: ${hex.toLowerCase()};`);
  });
});
