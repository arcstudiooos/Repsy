'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function ProgramsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load your programs." onRetry={reset} />;
}
