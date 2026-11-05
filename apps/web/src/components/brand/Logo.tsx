import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The Repsy mark: the founder's gradient "R" (public/brand/repsy-mark.png, transparent, cut from the full logo).
 * Decorative unless given a title; the wordmark or a label always sits next to it in the app.
 */
export function RepsyMark({ className, title }: { className?: string; title?: string }) {
  return (
    <Image
      src="/brand/repsy-mark.png"
      width={128}
      height={128}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={cn('size-8 shrink-0 object-contain', className)}
      priority
    />
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
      <RepsyMark className={mark} />
      Repsy
    </span>
  );
}
