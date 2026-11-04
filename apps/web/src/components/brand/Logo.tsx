import { cn } from '@/lib/utils';

/**
 * The Repsy mark: a midnight tile with three rising ember rep bars and a cyan dot for the next rep.
 * Decorative unless given a title; the wordmark or a label always sits next to it in the app.
 */
export function RepsyMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="9" fill="#101418" />
      <rect x="7.5" y="16" width="4" height="9" rx="2" fill="#E8552D" fillOpacity="0.55" />
      <rect x="14" y="12" width="4" height="13" rx="2" fill="#E8552D" fillOpacity="0.8" />
      <rect x="20.5" y="11" width="4" height="14" rx="2" fill="#E8552D" />
      <circle cx="22.5" cy="6.75" r="2.5" fill="#19C3D9" />
    </svg>
  );
}

/** Mark + "Repsy". `tone="light"` for midnight surfaces (the sidebar, hero cards). */
export function RepsyLogo({
  className,
  size = 'md',
  tone = 'ink',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'ink' | 'light';
}) {
  const text = { sm: 'text-base', md: 'text-lg', lg: 'text-3xl' }[size];
  const mark = { sm: 'size-6', md: 'size-7', lg: 'size-11' }[size];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight',
        text,
        tone === 'light' ? 'text-white' : 'text-ink',
        className,
      )}
    >
      <RepsyMark className={cn(mark, tone === 'light' && 'rounded-[9px] ring-1 ring-white/15')} />
      Repsy
    </span>
  );
}
