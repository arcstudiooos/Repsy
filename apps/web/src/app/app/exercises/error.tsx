'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function ExercisesError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load the exercise library." onRetry={reset} />;
}
