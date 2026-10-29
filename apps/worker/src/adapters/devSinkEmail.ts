import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmailMessage, EmailPort } from '@kinetic/core';

/** Dev/test adapter: one JSON file per email, no network. */
export class DevSinkEmailAdapter implements EmailPort {
  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeKey = message.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_');
    await writeFile(
      join(this.dir, `${stamp}_${safeKey}.json`),
      JSON.stringify(message, null, 2),
      'utf8',
    );
  }
}
