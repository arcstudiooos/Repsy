'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function WorkoutError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load this workout." onRetry={reset} />;
}
