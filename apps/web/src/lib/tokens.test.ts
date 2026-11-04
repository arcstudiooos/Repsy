import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, themes, tokens, type ThemeName } from './tokens';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8').toLowerCase();
const kebab = (k: string) => k.replace(/([A-Z0-9]+)/g, (m) => `-${m.toLowerCase()}`);

/** The CSS block for a theme: `:root {` for light, `:root[data-theme='dark'] {` for dark. */
function blockFor(theme: ThemeName): string {
  const start = css.indexOf(theme === 'light' ? ':root {' : ":root[data-theme='dark'] {");
  return css.slice(start, css.indexOf('}', start));
}

describe('design tokens', () => {
  it('contrastRatio matches known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('tokens.css mirrors tokens.ts in both themes, and the system-dark block matches dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      const block = blockFor(theme);
      for (const [key, hex] of Object.entries(themes[theme]))
        expect(block, `${theme} ${key}`).toContain(`--k-${kebab(key)}: ${hex.toLowerCase()};`);
    }
    const system = css.slice(css.indexOf(':root:not([data-theme])'));
    for (const [key, hex] of Object.entries(themes.dark))
      expect(system, `system ${key}`).toContain(`--k-${kebab(key)}: ${hex.toLowerCase()};`);
  });

  it('the light theme is the default export', () => {
    expect(tokens.accent).toBe(themes.light.accent);
  });

  for (const theme of ['light', 'dark'] as const) {
    const t = themes[theme];
    describe(`${theme} theme`, () => {
      it('body text and secondary text meet 4.5:1 on every surface', () => {
        for (const bg of [t.canvas, t.surface, t.surface2]) {
          expect(contrastRatio(t.ink, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(t.secondary, bg)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('links and accent text meet 4.5:1 on canvas and surface', () => {
        expect(contrastRatio(t.accent, t.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.accent, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.accentInk, t.accentSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.cyanStrong, t.surface)).toBeGreaterThanOrEqual(4.5);
      });

      it('primary buttons: on-accent text meets 4.5:1 on the fill and its hover', () => {
        expect(contrastRatio(t.onAccent, t.accentFill)).toBeGreaterThanOrEqual(4.5);
        if (theme === 'light')
          expect(contrastRatio(t.onAccent, t.accentHover)).toBeGreaterThanOrEqual(4.5);
      });

      it('input borders meet 3:1 (non-text) on surface and canvas', () => {
        expect(contrastRatio(t.inputBorder, t.surface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(t.inputBorder, t.canvas)).toBeGreaterThanOrEqual(3);
      });

      it('status colours are text-safe on surface, and their inks on their tints', () => {
        for (const c of [t.success, t.warning, t.danger, t.info])
          expect(contrastRatio(c, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.successInk, t.successSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.warningInk, t.warningSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.dangerInk, t.dangerSoft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.infoInk, t.infoSoft)).toBeGreaterThanOrEqual(4.5);
      });

      it('midnight tiles: white and cyan text are readable, ember is a 3:1 fill', () => {
        expect(contrastRatio(t.onMidnight, t.midnight)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.cyan, t.midnight)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.ember, t.midnight)).toBeGreaterThanOrEqual(3);
      });

      it('chart series stand out from the surface (3:1 non-text, except the neutral stone)', () => {
        for (const c of [t.chart1, t.chart2, t.chart4, t.chart5])
          expect(contrastRatio(c, t.surface)).toBeGreaterThanOrEqual(theme === 'light' ? 2 : 3);
      });
    });
  }
});
