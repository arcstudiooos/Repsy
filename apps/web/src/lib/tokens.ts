/**
 * Design tokens (PRD §6.2, D-008 #18). Single source for TypeScript consumers;
 * src/styles/tokens.css holds the same values as CSS variables (tokens.test.ts
 * checks they agree). Divider is decorative only: never use it as the sole
 * boundary of an input or control.
 */
export const tokens = {
  canvas: '#F3F5F4',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F0',
  ink: '#152825',
  accent: '#1C7666',
  accentHover: '#145B50',
  accentSoft: '#E2F1EC',
  accentInk: '#11564B',
  secondary: '#60716E',
  divider: '#E1E8E4',
  border: '#E3E9E6',
  inputBorder: '#7D8C87',
  warning: '#8F5A26',
  danger: '#B64743',
  success: '#1D7149',
  radiusCard: '14px',
  radiusControl: '8px',
  shadowCard: '0 1px 2px rgba(16, 36, 30, 0.05), 0 4px 16px rgba(16, 36, 30, 0.04)',
  spacing: [4, 8, 12, 16, 24, 32],
  motionFastMs: 120,
  motionBaseMs: 180,
} as const;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected #RRGGBB colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
