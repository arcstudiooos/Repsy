import type { Metadata } from 'next';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Create account | Repsy',
  description:
    'Start Repsy free with 3 clients. Programs, check-ins, messages and scheduling for coaches, no card needed.',
  alternates: { canonical: '/signup' },
};

export default function SignupPage() {
  return <SignupForm />;
}
