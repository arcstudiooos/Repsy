import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The product wordmark: a small accent tile and the name. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 text-lg font-semibold tracking-tight text-ink',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-7 items-center justify-center rounded-[8px] bg-accent text-white shadow-sm"
      >
        <Activity className="size-4" strokeWidth={2.5} />
      </span>
      Kinetic
    </p>
  );
}
