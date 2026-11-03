/**
 * Design tokens (PRD §6.2, D-008 #18). Single source for TypeScript consumers;
 * src/styles/tokens.css holds the same values as CSS variables (tokens.test.ts
 * checks they agree). Divider is decorative only: never use it as the sole
 * boundary of an input or control.
 */
export const tokens = {
  canvas: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F9',
  ink: '#0F172A',
  accent: '#4F46E5',
  accentHover: '#4338CA',
  accentSoft: '#EEF0FF',
  accentInk: '#3730A3',
  secondary: '#5B6477',
  divider: '#E8EAF2',
  border: '#E4E7EF',
  inputBorder: '#7E879B',
  warning: '#B45309',
  danger: '#DC2626',
  success: '#15803D',
  energy: '#F97316',
  energyInk: '#C2410C',
  successSoft: '#EAF7EF',
  successInk: '#166534',
  warningSoft: '#FEF3E2',
  warningInk: '#92400E',
  dangerSoft: '#FDECEC',
  dangerInk: '#B91C1C',
  chart1: '#4F46E5',
  chart2: '#F97316',
  chart3: '#0EA5E9',
  chart4: '#DB2777',
  chart5: '#64748B',
  radiusCard: '16px',
  radiusControl: '10px',
  shadowCard: '0 1px 2px rgba(15, 23, 42, 0.04), 0 2px 8px rgba(15, 23, 42, 0.04)',
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
