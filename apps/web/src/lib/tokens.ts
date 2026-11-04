/**
 * Design tokens, "Midnight & Ember" (Docs/ui-redesign-plan.md §2, D-014). Single source for TypeScript consumers;
 * src/styles/tokens.css holds the same values as CSS variables, per theme (tokens.test.ts checks they agree).
 * `divider` and `border` are decorative only: never the sole boundary of an input or control.
 */
export const themes = {
  light: {
    canvas: '#F7F5F2',
    surface: '#FFFFFF',
    surface2: '#F1EEEA',
    ink: '#14110F',
    secondary: '#625B55',
    divider: '#E9E4DE',
    border: '#E9E4DE',
    inputBorder: '#8C847C',
    accent: '#C7431C',
    accentHover: '#A93715',
    accentFill: '#C7431C',
    onAccent: '#FFFFFF',
    accentSoft: '#FBE3DA',
    accentInk: '#A93715',
    ember: '#E8552D',
    cyan: '#19C3D9',
    cyanStrong: '#0A7C8C',
    midnight: '#101418',
    onMidnight: '#FFFFFF',
    onMidnightMuted: '#A8B0BA',
    midnight2: '#1B2229',
    success: '#0B7A45',
    successSoft: '#E3F4EA',
    successInk: '#0B7A45',
    warning: '#9A5B00',
    warningSoft: '#FDF0DC',
    warningInk: '#8A5100',
    warningFill: '#FFB547',
    danger: '#C0283C',
    dangerSoft: '#FBE6E9',
    dangerInk: '#A8233A',
    info: '#0A7C8C',
    infoSoft: '#DFF4F7',
    infoInk: '#0A6F7D',
    chart1: '#E8552D',
    chart2: '#19C3D9',
    chart3: '#FFB547',
    chart4: '#7B61FF',
    chart5: '#3DBE7A',
    chart6: '#8C847C',
  },
  dark: {
    canvas: '#0B0E11',
    surface: '#141A1F',
    surface2: '#1C232A',
    ink: '#F4F2EF',
    secondary: '#A0A8B3',
    divider: '#262E36',
    border: '#262E36',
    inputBorder: '#6E7884',
    accent: '#FF6B43',
    accentHover: '#FF8A66',
    accentFill: '#E8552D',
    onAccent: '#101418',
    accentSoft: '#33190F',
    accentInk: '#FF8A66',
    ember: '#E8552D',
    cyan: '#19C3D9',
    cyanStrong: '#19C3D9',
    midnight: '#101418',
    onMidnight: '#FFFFFF',
    onMidnightMuted: '#A8B0BA',
    midnight2: '#1B2229',
    success: '#3DBE7A',
    successSoft: '#12291D',
    successInk: '#5BD593',
    warning: '#FFB547',
    warningSoft: '#2E2210',
    warningInk: '#FFC266',
    warningFill: '#FFB547',
    danger: '#FF6B7D',
    dangerSoft: '#331519',
    dangerInk: '#FF8A97',
    info: '#19C3D9',
    infoSoft: '#0E2A30',
    infoInk: '#4FD6E8',
    chart1: '#E8552D',
    chart2: '#19C3D9',
    chart3: '#FFB547',
    chart4: '#8F7BFF',
    chart5: '#3DBE7A',
    chart6: '#A0A8B3',
  },
} as const;

export type ThemeName = keyof typeof themes;
export type ColorToken = keyof (typeof themes)['light'];

/** The light theme, plus the scales that do not change with the theme. */
export const tokens = {
  ...themes.light,
  radiusSm: '8px',
  radiusMd: '12px',
  radiusLg: '16px',
  radiusXl: '24px',
  radiusCard: '16px',
  radiusControl: '8px',
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
