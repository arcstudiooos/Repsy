import type { Metadata } from 'next';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = { title: 'Create account | Repsy' };

export default function SignupPage() {
  return <SignupForm />;
}
