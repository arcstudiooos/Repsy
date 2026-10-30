'use client';

import { ErrorState } from '@/components/states/ErrorState';

export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState message="We could not load this page." onRetry={reset} />;
}
