'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function ClientsError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load your clients." onRetry={reset} />;
}
