import { cn } from '@/lib/utils';

/** Deterministic colours from the chart palette, with text colours that pass 4.5:1 (avatar.test.ts). */
export const AVATAR_TONES = [
  { bg: '#FBE3DA', fg: '#A93715' },
  { bg: '#DFF4F7', fg: '#0A6F7D' },
  { bg: '#FDF0DC', fg: '#8A5100' },
  { bg: '#ECE8FF', fg: '#4A36C7' },
  { bg: '#E3F4EA', fg: '#0B6B3C' },
  { bg: '#EFEBE7', fg: '#5C554F' },
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

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
};

/** Initials avatar. Decorative: the person's name is always shown or announced next to it. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const t = avatarTone(name);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars with a "+N" chip. The label names how many people it shows. */
export function AvatarStack({
  names,
  max = 4,
  label,
}: {
  names: string[];
  max?: number;
  label: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span role="img" aria-label={label} className="flex -space-x-2">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="xs" className="ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span
          aria-hidden
          className="inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-secondary ring-2 ring-surface"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
