import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmailPort } from '@kinetic/core';
import { DevSinkEmailAdapter } from './devSinkEmail';
import { ResendEmailAdapter } from './resendEmail';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Resend when RESEND_API_KEY is set, otherwise the dev sink. In production a
 * missing RESEND_API_KEY or EMAIL_FROM is a boot error: silently writing real
 * users' emails to a local directory would look healthy while sending nothing.
 */
export function createEmailPort(env: NodeJS.ProcessEnv = process.env): EmailPort {
  if (env.NODE_ENV === 'production') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required in production');
    if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is required in production');
  }
  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM;
    if (!from) throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set');
    return new ResendEmailAdapter(env.RESEND_API_KEY, from);
  }
  // Blank counts as unset (.env.example ships `DEV_EMAIL_DIR=`).
  return new DevSinkEmailAdapter(env.DEV_EMAIL_DIR?.trim() || join(repoRoot, '.dev-emails'));
}
