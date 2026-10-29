import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailPort } from '@kinetic/core';
import { createLogger, logger as defaultLogger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DevSinkEmailAdapter } from '../adapters/devSinkEmail';
import { deliverEmail, EMAIL_RETRY_LIMIT, pollPendingEmails } from './emailDeliver';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;
let userId: string;
let seq = 0;

const quiet = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));

async function seedEmail(): Promise<string> {
  seq += 1;
  const row = await withSystem(
    (tx) =>
      tx.outboxEmail.create({
        data: {
          organizationId: orgId,
          kind: 'invite',
          toUserId: userId,
          templateKey: 'invite',
          payloadJson: { subject: 'Hello', text: 'Hi there' },
          idempotencyKey: `key-${seq}`,
        },
      }),
    prisma,
  );
  return row.id;
}

const load = (id: string) =>
  withSystem((tx) => tx.outboxEmail.findUniqueOrThrow({ where: { id } }), prisma);

function fakePort(failures: number) {
  const sent: EmailMessage[] = [];
  let remaining = failures;
  const send = vi.fn(async (message: EmailMessage) => {
    if (remaining > 0) {
      remaining -= 1;
      throw new Error('provider down');
    }
    sent.push(message);
  });
  const port: EmailPort = { send };
  return { port, send, sent };
}

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'rcpt@example.test', name: 'R' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
    });
    userId = user.id;
    orgId = org.id;
  }, prisma);
});

afterAll(async () => {
  await drop();
});

describe('deliverEmail', () => {
  it('retries then succeeds without double-send', async () => {
    const id = await seedEmail();
    const { port, send, sent } = fakePort(1);
    const deps = { prisma, port, logger: quiet };

    await expect(deliverEmail(deps, id)).rejects.toThrow('provider down');
    expect(await load(id)).toMatchObject({ status: 'pending', attempts: 1 });

    expect(await deliverEmail(deps, id)).toBe('sent');
    expect(await load(id)).toMatchObject({ status: 'sent' });
    expect((await load(id)).sentAt).toBeInstanceOf(Date);

    expect(await deliverEmail(deps, id)).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'rcpt@example.test',
      subject: 'Hello',
      idempotencyKey: expect.stringMatching(/^key-/),
    });
  });

  it('marks failed after retryLimit 5', async () => {
    expect(EMAIL_RETRY_LIMIT).toBe(5);
    const id = await seedEmail();
    const { port, send } = fakePort(Infinity);
    const deps = { prisma, port, logger: quiet };

    for (let attempt = 1; attempt < EMAIL_RETRY_LIMIT; attempt += 1) {
      await expect(deliverEmail(deps, id)).rejects.toThrow('provider down');
      expect(await load(id)).toMatchObject({ status: 'pending', attempts: attempt });
    }
    expect(await deliverEmail(deps, id)).toBe('failed');
    expect(await load(id)).toMatchObject({ status: 'failed', attempts: EMAIL_RETRY_LIMIT });

    expect(await deliverEmail(deps, id)).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(EMAIL_RETRY_LIMIT);
  });
});

describe('pollPendingEmails', () => {
  it('queues one deliver job per pending row, keyed by row id', async () => {
    const id = await seedEmail();
    const queued: Array<{ name: string; data: object; options: object }> = [];
    const sender = {
      send: async (name: string, data: object, options: object) => {
        queued.push({ name, data, options });
        return 'job';
      },
    };
    const count = await pollPendingEmails({ prisma, sender, logger: quiet });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(queued).toContainEqual({
      name: 'email.deliver',
      data: { outboxId: id },
      options: expect.objectContaining({ singletonKey: id }),
    });
  });
});

describe('DevSinkEmailAdapter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kinetic-emails-'));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes one json file per email', async () => {
    const adapter = new DevSinkEmailAdapter(dir);
    await adapter.send({
      to: 'a@example.test',
      subject: 'S',
      text: 'T',
      html: '<p>T</p>',
      templateKey: 'invite',
      payload: { a: 1 },
      idempotencyKey: 'idem-1',
    });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('idem-1');
    const saved = JSON.parse(await readFile(join(dir, files[0] ?? ''), 'utf8'));
    expect(saved).toMatchObject({
      to: 'a@example.test',
      subject: 'S',
      text: 'T',
      html: '<p>T</p>',
      templateKey: 'invite',
      payload: { a: 1 },
    });
  });
});

describe('logger', () => {
  it('logger redacts body', () => {
    const lines: string[] = [];
    const log = createLogger(
      new Writable({
        write(chunk, _enc, cb) {
          lines.push(String(chunk));
          cb();
        },
      }),
    );
    log.info({ body: 'secret-msg', password: 'pw', token: 't', req: { body: 'nested' } }, 'x');
    const out = lines.join('');
    expect(out).not.toMatch(/secret-msg|nested|"pw"|"t"/);
    expect(out).toContain('[Redacted]');
    expect(defaultLogger).toBeDefined();
  });
});
