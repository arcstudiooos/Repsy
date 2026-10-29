'use client';

import { secondaryButtonClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  return (
    <button
      type="button"
      className={`${secondaryButtonClass} max-w-48`}
      onClick={() => void authClient.signOut().then(() => window.location.assign('/login'))}
    >
      Sign out
    </button>
  );
}
