'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function ReviewError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load the review list." onRetry={reset} />;
}
