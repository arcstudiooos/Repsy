import type { Metadata } from 'next';
import { ResendVerification } from './ResendVerification';
import { AuthShell } from '@/components/auth-ui';

export const metadata: Metadata = { title: 'Verify your email | Repsy' };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Check your email">
      <p className="mb-4 text-base">
        We sent a verification link to your email address. Open it to finish setting up your
        account. The link expires in 1 hour.
      </p>
      <ResendVerification />
    </AuthShell>
  );
}
