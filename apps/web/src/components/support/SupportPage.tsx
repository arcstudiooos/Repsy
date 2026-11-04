import Link from 'next/link';
import { Suspense } from 'react';
import { SUPPORT_RESPONSE_TARGET } from '@kinetic/core';
import { SupportForm } from './SupportForm';

/** PRD M13: help, the status page and the changelog in one place. */
export function SupportPage({ coach = false }: { coach?: boolean }) {
  return (
    <>
      <h1 className="mb-2 text-h1 font-semibold md:text-display">Help and support</h1>
      <p className="mb-6 text-secondary">
        Something unclear or not working? Tell us here.{' '}
        <Link href="/status" className="text-accent underline">
          Service status
        </Link>{' '}
        ·{' '}
        <Link href="/changelog" className="text-accent underline">
          What’s new
        </Link>
      </p>
      <div className="max-w-2xl">
        <Suspense>
          <SupportForm responseTarget={SUPPORT_RESPONSE_TARGET} coach={coach} />
        </Suspense>
      </div>
    </>
  );
}
