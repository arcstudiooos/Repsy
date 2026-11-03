import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-ui';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = {
  title: 'Thank you | Kinetic',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

/** PRD K4: back from the hosted checkout. The payment is confirmed by the provider's webhook, so say what comes next. */
export default function ThanksPage() {
  return (
    <AuthShell title="Thank you">
      <p className="text-base">
        We&apos;re confirming your payment. You&apos;ll get an email with your receipt and, if
        you&apos;re new here, a link to set up your account.
      </p>
    </AuthShell>
  );
}
