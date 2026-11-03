import type { Metadata } from 'next';
import { SignupForm } from './SignupForm';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Create account | Kinetic' };

export default function SignupPage() {
  return <SignupForm />;
}
