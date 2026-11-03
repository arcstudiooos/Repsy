import { cn } from '@/lib/utils';

/**
 * Soft tint + dark ink pairs; every ink is at least 4.5:1 on its tint (avatar.test.ts). Picked by a stable hash of
 * the name, so the same person always gets the same colour.
 */
export const AVATAR_TONES = [
  { bg: '#E2F1EC', fg: '#11564B' },
  { bg: '#FCEBD9', fg: '#7A4413' },
  { bg: '#E3ECFA', fg: '#22467F' },
  { bg: '#F8E4E6', fg: '#8A2F3B' },
  { bg: '#E9EEE1', fg: '#3F5524' },
  { bg: '#ECE8F5', fg: '#4A3D78' },
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
