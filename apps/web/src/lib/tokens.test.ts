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
    expect(tokens.brand).toBe(themes.light.brand);
  });

  it('older token names alias the palette (screens written before D-018 follow it)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const t = themes[theme];
      expect(t.accent).toBe(t.brand);
      expect(t.accentFill).toBe(t.brand);
      expect(t.accentSoft).toBe(t.brandSoft);
      expect(t.accentInk).toBe(t.brandInk);
      expect(t.onAccent).toBe(t.onBrand);
      expect(t.secondary).toBe(t.inkMuted);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    const t = themes[theme];
    const AA = 4.5;
    describe(`${theme} theme (palette 19, Periwinkle & Acid)`, () => {
      it('ink and ink-muted meet 4.5:1 on canvas, surface, surface-2 and the sidebar', () => {
        for (const bg of [t.canvas, t.surface, t.surface2, t.sidebar]) {
          expect(contrastRatio(t.ink, bg)).toBeGreaterThanOrEqual(AA);
          expect(contrastRatio(t.inkMuted, bg)).toBeGreaterThanOrEqual(AA);
        }
      });

      it('brand text (links, active nav) meets 4.5:1 on canvas, surface and the sidebar', () => {
        for (const bg of [t.canvas, t.surface, t.sidebar])
          expect(contrastRatio(t.brand, bg)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.brandInk, t.brandSoft)).toBeGreaterThanOrEqual(AA);
      });

      it('primary buttons: on-brand text meets 4.5:1 on brand and its hover', () => {
        expect(contrastRatio(t.onBrand, t.brand)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.onBrand, t.brandHover)).toBeGreaterThanOrEqual(AA);
      });

      it('acid: on-acid text on acid, acid-ink on acid-soft', () => {
        expect(contrastRatio(t.onAcid, t.acid)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.acidInk, t.acidSoft)).toBeGreaterThanOrEqual(AA);
      });

      if (theme === 'light') {
        it('acid is never text or a lone shape on white (it fails 3:1), so it always gets an outline', () => {
          expect(contrastRatio(t.acid, t.surface)).toBeLessThan(3);
          expect(contrastRatio(t.onAcid, t.surface)).toBeGreaterThanOrEqual(3);
        });
      } else {
        it('acid may be text on dark surfaces', () => {
          for (const bg of [t.canvas, t.surface, t.surface2])
            expect(contrastRatio(t.acid, bg)).toBeGreaterThanOrEqual(AA);
        });
      }

      it('input borders meet 3:1 (non-text) on surface and canvas', () => {
        expect(contrastRatio(t.inputBorder, t.surface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(t.inputBorder, t.canvas)).toBeGreaterThanOrEqual(3);
      });

      it('status colours are text-safe on surface, and their inks on their soft tints', () => {
        for (const c of [t.success, t.warning, t.danger, t.info])
          expect(contrastRatio(c, t.surface)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.successInk, t.successSoft)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.warningInk, t.warningSoft)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.dangerInk, t.dangerSoft)).toBeGreaterThanOrEqual(AA);
        expect(contrastRatio(t.infoInk, t.infoSoft)).toBeGreaterThanOrEqual(AA);
      });

      it('brand hero surfaces (auth panel, next-workout card): white, muted and acid read on both layers', () => {
        for (const bg of [t.midnight, t.midnight2]) {
          expect(contrastRatio(t.onMidnight, bg)).toBeGreaterThanOrEqual(AA);
          expect(contrastRatio(t.onMidnightMuted, bg)).toBeGreaterThanOrEqual(AA);
          expect(contrastRatio(t.acid, bg)).toBeGreaterThanOrEqual(3);
        }
      });

      it('every chart series and session-state colour is 3:1 against the surface (WCAG 1.4.11)', () => {
        for (const c of [t.chart1, t.chart2, t.chart3, t.chart4, t.chart5, t.chart6, t.unfinished])
          expect(contrastRatio(c, t.surface)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
