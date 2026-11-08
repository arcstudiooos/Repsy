/**
 * The message on /login after a Google or Microsoft sign-in comes back with an error. Better Auth adds `error` to the
 * error URL: `signup_disabled` when no Repsy account uses that email (signing in never creates one).
 */
export type SsoMessage = { text: string; signUpLink: boolean };

export function ssoMessage(sso: string | undefined, error: string | undefined): SsoMessage | null {
  if (sso === 'google') {
    if (error === 'signup_disabled') {
      return {
        text: 'No Repsy account uses that Google email yet. New coaches create one with Sign up with Google. Clients sign in from their coach’s invite.',
        signUpLink: true,
      };
    }
    return {
      text: 'Google sign-in did not finish. Try again, or email hello@repsy.fit if it keeps happening.',
      signUpLink: false,
    };
  }
  if (sso === 'refused') {
    return {
      text: 'That sign-in was refused. Ask your workspace owner to invite you with this email, or to set up single sign-on for your organisation.',
      signUpLink: false,
    };
  }
  return null;
}
