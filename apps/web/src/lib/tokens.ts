/**
 * Design tokens, "Periwinkle & Acid", palette 19 (Docs/ui-redesign-plan.md §2.1, D-018). Single source for TypeScript consumers;
 * src/styles/tokens.css holds the same values as CSS variables, per theme (tokens.test.ts checks they agree).
 * `divider` and `border` are decorative only: never the sole boundary of an input or control.
 */
export const themes = {
  light: {
    canvas: '#F5F5FF',
    surface: '#FFFFFF',
    surface2: '#EEEEFB',
    sidebar: '#EEEEFC',
    ink: '#12131F',
    inkMuted: '#4A5160',
    secondary: '#4A5160',
    divider: '#E2E2F2',
    border: '#E2E2F2',
    inputBorder: '#8A8CA6',
    brand: '#5B5BD6',
    brandHover: '#4A4AC4',
    brandPressed: '#3D3DAE',
    brandSoft: '#E4E4FB',
    onBrand: '#FFFFFF',
    brandInk: '#3D3DAE',
    acid: '#E8FF47',
    acidSoft: '#F7FFC2',
    onAcid: '#12131F',
    acidInk: '#5C6B00',
    accent: '#5B5BD6',
    accentHover: '#4A4AC4',
    accentFill: '#5B5BD6',
    onAccent: '#FFFFFF',
    accentSoft: '#E4E4FB',
    accentInk: '#3D3DAE',
    ember: '#5B5BD6',
    cyan: '#0E8FA3',
    cyanStrong: '#0A7C8C',
    midnight: '#5B5BD6',
    onMidnight: '#FFFFFF',
    onMidnightMuted: '#F0F0FF',
    midnight2: '#4747BD',
    success: '#0B7A45',
    successSoft: '#E3F6EC',
    successInk: '#0B7A45',
    warning: '#9A5B00',
    warningSoft: '#FFF1D6',
    warningInk: '#8A5100',
    warningFill: '#C27C00',
    unfinished: '#B45309',
    danger: '#C0283C',
    dangerSoft: '#FDE7EA',
    dangerInk: '#A8233A',
    info: '#0A7C8C',
    infoSoft: '#DDF4F7',
    infoInk: '#08707E',
    chart1: '#5B5BD6',
    chart2: '#0E8FA3',
    chart3: '#D6407A',
    chart4: '#C27C00',
    chart5: '#2E9E5B',
    chart6: '#6B6F86',
  },
  dark: {
    canvas: '#0E0F1A',
    surface: '#171828',
    surface2: '#1F2135',
    sidebar: '#131425',
    ink: '#F1F1FA',
    inkMuted: '#A3A6C2',
    secondary: '#A3A6C2',
    divider: '#2A2C44',
    border: '#2A2C44',
    inputBorder: '#6B6E8C',
    brand: '#8E8EF5',
    brandHover: '#A5A5F8',
    brandPressed: '#7676E8',
    brandSoft: '#272A52',
    onBrand: '#0E0F1A',
    brandInk: '#C9C9FB',
    acid: '#E8FF47',
    acidSoft: '#363B2D',
    onAcid: '#12131F',
    acidInk: '#E8FF47',
    accent: '#8E8EF5',
    accentHover: '#A5A5F8',
    accentFill: '#8E8EF5',
    onAccent: '#0E0F1A',
    accentSoft: '#272A52',
    accentInk: '#C9C9FB',
    ember: '#8E8EF5',
    cyan: '#22D3EE',
    cyanStrong: '#22D3EE',
    midnight: '#23255A',
    onMidnight: '#FFFFFF',
    onMidnightMuted: '#C8C9E6',
    midnight2: '#2E3170',
    success: '#4ADE80',
    successSoft: '#1F3635',
    successInk: '#4ADE80',
    warning: '#FBBF24',
    warningSoft: '#393127',
    warningInk: '#FBBF24',
    warningFill: '#FBBF24',
    unfinished: '#FB923C',
    danger: '#F87171',
    dangerSoft: '#392533',
    dangerInk: '#F87171',
    info: '#22D3EE',
    infoSoft: '#193446',
    infoInk: '#22D3EE',
    chart1: '#8E8EF5',
    chart2: '#22B8CC',
    chart3: '#F06A9B',
    chart4: '#F0A93B',
    chart5: '#4ADE80',
    chart6: '#8F93AD',
  },
} as const;

export type ThemeName = keyof typeof themes;
export type ColorToken = keyof (typeof themes)['light'];

/** The light theme, plus the scales that do not change with the theme. */
export const tokens = {
  ...themes.light,
  radiusSm: '10px',
  radiusMd: '12px',
  radiusLg: '16px',
  radiusXl: '20px',
  radiusCard: '16px',
  radiusControl: '10px',
  spacing: [4, 8, 12, 16, 20, 24, 32, 40],
  motionFastMs: 120,
  motionBaseMs: 180,
  motionSlowMs: 240,
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
