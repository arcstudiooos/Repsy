'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function WorkoutsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load your workouts." onRetry={reset} />;
}
