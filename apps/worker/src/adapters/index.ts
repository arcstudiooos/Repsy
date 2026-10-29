import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmailPort } from '@kinetic/core';
import { DevSinkEmailAdapter } from './devSinkEmail';
import { ResendEmailAdapter } from './resendEmail';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Resend when RESEND_API_KEY is set, otherwise the dev sink. */
export function createEmailPort(env: NodeJS.ProcessEnv = process.env): EmailPort {
  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM;
    if (!from) throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set');
    return new ResendEmailAdapter(env.RESEND_API_KEY, from);
  }
  return new DevSinkEmailAdapter(env.DEV_EMAIL_DIR ?? join(repoRoot, '.dev-emails'));
}
