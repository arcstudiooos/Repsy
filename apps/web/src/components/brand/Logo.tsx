import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Repsy mark: three rising rep bars on an indigo-to-violet tile, the last one capped with an energy-orange
 * dot (the next rep). Decorative wherever the wordmark or a label sits next to it.
 */
export function RepsyMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-g)`} />
      <rect x="7.5" y="16" width="4" height="9" rx="2" fill="#fff" fillOpacity="0.6" />
      <rect x="14" y="12" width="4" height="13" rx="2" fill="#fff" fillOpacity="0.8" />
      <rect x="20.5" y="11" width="4" height="14" rx="2" fill="#fff" />
      <circle cx="22.5" cy="6.75" r="2.5" fill="#F97316" />
    </svg>
  );
}

/**
 * The lockup people should remember: the mark, then "repsy" with ".fit" in the energy colour, read as one name.
 * The accessible name is "Repsy.fit".
 */
export function RepsyLogo({
  className,
  size = 'md',
  tone = 'ink',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** 'light' for dark or gradient backgrounds. */
  tone?: 'ink' | 'light';
}) {
  const text = { sm: 'text-base', md: 'text-lg', lg: 'text-3xl' }[size];
  const mark = { sm: 'size-6', md: 'size-7', lg: 'size-11' }[size];
  return (
    <span
      className={cn('inline-flex items-center gap-2 font-bold tracking-tight', text, className)}
    >
      <RepsyMark className={cn(mark, tone === 'light' && 'ring-1 ring-white/25 rounded-[9px]')} />
      <span aria-label="Repsy.fit" role="img" className="leading-none">
        <span aria-hidden className={tone === 'light' ? 'text-white' : 'text-ink'}>
          repsy
        </span>
        <span aria-hidden className={tone === 'light' ? 'text-[#FDBA74]' : 'text-energy-ink'}>
          .fit
        </span>
      </span>
    </span>
  );
}
