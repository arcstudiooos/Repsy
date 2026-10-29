import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DevSinkEmailAdapter } from './devSinkEmail';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sink-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

it('file name carries a hash of the idempotency key, never the key or token itself', async () => {
  const key = 'auth.verify_email:user-1:SECRET-TOKEN-abc123/very-long-'.repeat(8);
  await new DevSinkEmailAdapter(dir).send({
    to: 'a@example.test',
    subject: 's',
    text: 't',
    html: '<p>t</p>',
    templateKey: 'k',
    payload: {},
    idempotencyKey: key,
  });
  const [name] = await readdir(dir);
  expect(name).toBeDefined();
  expect(name).not.toContain('SECRET');
  expect(name).not.toContain('auth.verify');
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 16);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_[0-9a-f]{16}\.json$/);
  expect(name).toContain(`_${digest}.json`);
  expect((name ?? '').length).toBeLessThan(60);
});
