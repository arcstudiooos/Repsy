import { RepsyLogo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

/** The product wordmark in the app shells. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center', className)}>
      <RepsyLogo size="md" />
    </p>
  );
}
