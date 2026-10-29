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
import { backoffMs, deliverDueEmails, EMAIL_RETRY_LIMIT, queueEmailSweep } from './emailDeliver';

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
          nextAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
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

const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function clock() {
  let t = T0.getTime();
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

/** Isolates a test from rows seeded by other tests. */
async function seedOnly(): Promise<string> {
  await withSystem(
    (tx) => tx.outboxEmail.updateMany({ where: { status: 'pending' }, data: { status: 'failed' } }),
    prisma,
  );
  return seedEmail();
}

describe('deliverDueEmails', () => {
  it('retries then succeeds without double-send', async () => {
    const id = await seedOnly();
    const { port, send, sent } = fakePort(1);
    const c = clock();
    const deps = { prisma, port, logger: quiet, now: c.now };

    expect(await deliverDueEmails(deps)).toEqual({ sent: 0, retried: 1, failed: 0 });
    expect(await load(id)).toMatchObject({ status: 'pending', attempts: 1, leaseUntil: null });

    c.advance(30_000);
    expect(await deliverDueEmails(deps)).toEqual({ sent: 1, retried: 0, failed: 0 });
    const row = await load(id);
    expect(row).toMatchObject({ status: 'sent', attempts: 2 });
    expect(row.sentAt).toEqual(at(30_000));

    c.advance(600_000);
    expect(await deliverDueEmails(deps)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    // Payload (may carry a single-use link) is not kept after a successful send.
    expect(row.payloadJson).toEqual({});
    expect(sent[0]).toMatchObject({
      to: 'rcpt@example.test',
      subject: 'Hello',
      idempotencyKey: expect.stringMatching(/^key-/),
    });
  });

  it('schedules exponential backoff and does not retry early', async () => {
    const id = await seedOnly();
    const { port, send } = fakePort(Infinity);
    const c = clock();
    const deps = { prisma, port, logger: quiet, now: c.now };

    let elapsed = 0;
    for (const [i, delay] of [30_000, 60_000, 120_000, 240_000].entries()) {
      await deliverDueEmails(deps);
      expect(await load(id)).toMatchObject({
        status: 'pending',
        attempts: i + 1,
        nextAttemptAt: at(elapsed + delay),
      });
      c.advance(delay - 1);
      await deliverDueEmails(deps); // one ms early: not due
      expect(send).toHaveBeenCalledTimes(i + 1);
      c.advance(1);
      elapsed += delay;
    }
  });

  it('marks failed after retryLimit 5', async () => {
    expect(EMAIL_RETRY_LIMIT).toBe(5);
    const id = await seedOnly();
    const { port, send } = fakePort(Infinity);
    const c = clock();
    const deps = { prisma, port, logger: quiet, now: c.now };

    for (let attempt = 1; attempt < EMAIL_RETRY_LIMIT; attempt += 1) {
      await deliverDueEmails(deps);
      expect(await load(id)).toMatchObject({ status: 'pending', attempts: attempt });
      c.advance(backoffMs(attempt));
    }
    expect(await deliverDueEmails(deps)).toEqual({ sent: 0, retried: 0, failed: 1 });
    const failed = await load(id);
    expect(failed).toMatchObject({ status: 'failed', attempts: EMAIL_RETRY_LIMIT });
    expect(failed.payloadJson).toEqual({});

    c.advance(3_600_000);
    await deliverDueEmails(deps);
    expect(send).toHaveBeenCalledTimes(EMAIL_RETRY_LIMIT);
  });

  it('two concurrent sweeps over one row send exactly once', async () => {
    const id = await seedOnly();
    const { port, send } = fakePort(0);
    const deps = { prisma, port, logger: quiet, now: () => T0 };

    const results = await Promise.all([deliverDueEmails(deps), deliverDueEmails(deps)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(await load(id)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('keeps every attempt count when failures run concurrently', async () => {
    const ids = [await seedOnly(), await seedEmail(), await seedEmail()];
    const { port } = fakePort(Infinity);
    const deps = { prisma, port, logger: quiet, now: () => T0 };

    await Promise.all([deliverDueEmails(deps), deliverDueEmails(deps), deliverDueEmails(deps)]);
    for (const id of ids) {
      expect(await load(id)).toMatchObject({ status: 'pending', attempts: 1 });
    }
  });

  it('reclaims an expired lease and sends once', async () => {
    const id = await seedOnly();
    // Simulate a crashed sender: claimed, lease in the past.
    await withSystem(
      (tx) =>
        tx.outboxEmail.update({
          where: { id },
          data: { status: 'sending', attempts: 1, leaseUntil: at(-1000) },
        }),
      prisma,
    );
    const { port, send } = fakePort(0);
    const deps = { prisma, port, logger: quiet, now: () => T0 };

    expect(await deliverDueEmails(deps)).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await load(id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('does not touch a live lease', async () => {
    const id = await seedOnly();
    await withSystem(
      (tx) =>
        tx.outboxEmail.update({
          where: { id },
          data: { status: 'sending', attempts: 1, leaseUntil: at(60_000) },
        }),
      prisma,
    );
    const { port, send } = fakePort(0);
    await deliverDueEmails({ prisma, port, logger: quiet, now: () => T0 });
    expect(send).not.toHaveBeenCalled();
    expect(await load(id)).toMatchObject({ status: 'sending' });
  });
});

describe('failure reporting', () => {
  it('reports a row that turns failed after the last attempt', async () => {
    const id = await seedOnly();
    await withSystem(
      (tx) => tx.outboxEmail.update({ where: { id }, data: { attempts: EMAIL_RETRY_LIMIT - 1 } }),
      prisma,
    );
    const captureException = vi.fn();
    const { port } = fakePort(Infinity);
    await deliverDueEmails({ prisma, port, logger: quiet, now: () => T0, captureException });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({ outboxId: id });
  });

  it('reports a row failed by lease reclaim, and not plain retries', async () => {
    const id = await seedOnly();
    await withSystem(
      (tx) =>
        tx.outboxEmail.update({
          where: { id },
          data: { status: 'sending', attempts: EMAIL_RETRY_LIMIT, leaseUntil: at(-1000) },
        }),
      prisma,
    );
    const retryId = await seedEmail();
    const captureException = vi.fn();
    const { port } = fakePort(Infinity);
    await deliverDueEmails({ prisma, port, logger: quiet, now: () => T0, captureException });
    expect(await load(id)).toMatchObject({ status: 'failed', payloadJson: {} });
    expect(await load(retryId)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({ outboxId: id });
  });
});

describe('queueEmailSweep', () => {
  it('queues one sweep job throttled to the poll interval', async () => {
    const calls: Array<{ name: string; options: object }> = [];
    const sender = {
      send: async (name: string, _data: object, options: object) => {
        calls.push({ name, options });
        return 'job';
      },
    };
    await queueEmailSweep(sender, 45_000);
    expect(calls).toEqual([{ name: 'email.deliver', options: { singletonSeconds: 45 } }]);
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
    expect(files[0]).not.toContain('idem-1');
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
