'use client';

import { secondaryButtonClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      className={`${secondaryButtonClass} mt-3`}
      onClick={() => void authClient.signIn.social({ provider: 'google', callbackURL: '/app' })}
    >
      Continue with Google
    </button>
  );
}
