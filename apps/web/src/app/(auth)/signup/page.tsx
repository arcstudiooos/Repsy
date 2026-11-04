import type { Metadata } from 'next';
import { SignupForm } from './SignupForm';

export const metadata: Metadata = { title: 'Create account | Kinetic' };

export default function SignupPage() {
  return <SignupForm />;
}
