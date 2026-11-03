/**
 * Brand colour checks (PRD A6). Pure, so the settings form can use it too (`@kinetic/core/brand-color`).
 * The accent fills buttons with white text, so it must reach WCAG AA (4.5:1) against white.
 */
export const HEX = /^#[0-9a-f]{6}$/;
export const MIN_CONTRAST = 4.5;

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two #rrggbb colours (1-21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour scaled toward black by `amount` (0-1), for the hover state. */
export function darken(hex: string, amount = 0.2): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const scale = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  const r = scale((n >> 16) & 255);
  const g = scale((n >> 8) & 255);
  const b = scale(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Null when the accent is usable; otherwise why not. */
export function accentProblem(hex: string): string | null {
  const v = hex.trim().toLowerCase();
  if (!HEX.test(v)) return 'Use a colour like #4f46e5.';
  const ratio = contrastRatio(v, '#ffffff');
  if (ratio < MIN_CONTRAST) {
    return `White text on this colour has a contrast of ${ratio.toFixed(1)}:1; pick a darker colour (4.5:1 or more).`;
  }
  return null;
}
