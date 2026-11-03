import { cn } from '@/lib/utils';

/**
 * Soft tint + dark ink pairs; every ink is at least 4.5:1 on its tint (avatar.test.ts). Picked by a stable hash of
 * the name, so the same person always gets the same colour.
 */
export const AVATAR_TONES = [
  { bg: '#E0E7FF', fg: '#3730A3' },
  { bg: '#FFEDD5', fg: '#9A3412' },
  { bg: '#E0F2FE', fg: '#075985' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#CCFBF1', fg: '#115E59' },
  { bg: '#FEF3C7', fg: '#92400E' },
] as const;

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const;

/** Initials avatar. Decorative: the name it stands for is always shown or announced next to it. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const tone = avatarTone(name);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {initials(name)}
    </span>
  );
}
