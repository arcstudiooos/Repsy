import { connection } from 'next/server';
import { GoogleSignInButton } from './GoogleSignInButton';

/** Rendered only when both Google env vars are set (read at request time, not build time). */
export async function GoogleButton() {
  await connection();
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  return <GoogleSignInButton />;
}
