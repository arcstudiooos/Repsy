import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmailMessage, EmailPort } from '@kinetic/core';

/** Dev/test adapter: one JSON file per email, no network. */
export class DevSinkEmailAdapter implements EmailPort {
  constructor(readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // The key can embed a single-use token and be long (MAX_PATH): name by its hash instead.
    const keyHash = createHash('sha256').update(message.idempotencyKey).digest('hex').slice(0, 16);
    await writeFile(
      join(this.dir, `${stamp}_${keyHash}.json`),
      JSON.stringify(message, null, 2),
      'utf8',
    );
  }
}
