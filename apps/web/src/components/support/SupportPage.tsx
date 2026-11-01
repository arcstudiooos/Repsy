import Link from 'next/link';
import { SUPPORT_RESPONSE_TARGET } from '@kinetic/core';
import { SupportForm } from './SupportForm';

/** PRD M13: help, the status page and the changelog in one place. */
export function SupportPage() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Help and support</h1>
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
        <SupportForm responseTarget={SUPPORT_RESPONSE_TARGET} />
      </div>
    </>
  );
}
