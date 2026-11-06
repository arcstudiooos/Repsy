'use client';

import { secondaryButtonClass } from '@/components/auth-ui';
import { authClient } from '@/lib/auth-client';

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      className={`${secondaryButtonClass} mt-3`}
      onClick={() =>
        void authClient.signIn.social({
          provider: 'google',
          callbackURL: '/app',
          errorCallbackURL: '/login?sso=refused',
        })
      }
    >
      Continue with Google
    </button>
  );
}

/** PRD A16: Microsoft Entra ID single sign-on for workspaces that set it up. */
export function MicrosoftSignInButton() {
  return (
    <button
      type="button"
      className={`${secondaryButtonClass} mt-3`}
      onClick={() =>
        void authClient.signIn.social({
          provider: 'microsoft',
          callbackURL: '/app',
          errorCallbackURL: '/login?sso=refused',
        })
      }
    >
      Continue with Microsoft
    </button>
  );
}
