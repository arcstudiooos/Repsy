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
          // One Google button everywhere: an existing account signs in, a new email gets an account and onboarding.
          requestSignUp: true,
          callbackURL: '/app',
          newUserCallbackURL: '/onboarding/pilot-code',
          errorCallbackURL: '/login?sso=google',
        })
      }
    >
      Continue with Google
    </button>
  );
}

/** New coach account with Google; the workspace is set up next, at onboarding. */
export function GoogleSignUpButton() {
  return (
    <button
      type="button"
      className={secondaryButtonClass}
      onClick={() =>
        void authClient.signIn.social({
          provider: 'google',
          requestSignUp: true,
          callbackURL: '/app',
          newUserCallbackURL: '/onboarding/pilot-code',
          errorCallbackURL: '/signup?google=failed',
        })
      }
    >
      Sign up with Google
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
