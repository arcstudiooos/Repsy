import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { EmailMessage } from '@kinetic/core';
import { createLogger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createBoss } from './boss';
import { emailDeliverJob, pollPendingEmails } from './jobs/emailDeliver';
import { registerJobs } from './jobs/registry';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

// Boots real pg-boss with the superuser DATABASE_URL: pg-boss creates its own
// `pgboss` schema, which the restricted app role may not do.
it('pg-boss delivers a polled outbox row end to end', async () => {
  const outboxId = await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'boot@example.test', name: 'B' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
    });
    const row = await tx.outboxEmail.create({
      data: {
        organizationId: org.id,
        kind: 'k',
        toUserId: user.id,
        templateKey: 't',
        payloadJson: {},
        idempotencyKey: 'boot-1',
      },
    });
    return row.id;
  }, prisma);

  const sent: EmailMessage[] = [];
  const logger = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));
  const boss = createBoss(process.env.DATABASE_URL ?? '');
  await boss.start();
  try {
    await registerJobs(boss, [emailDeliverJob], {
      prisma,
      port: { send: async (m) => void sent.push(m) },
      logger,
    });
    await pollPendingEmails({ prisma, sender: boss, logger });
    await expect
      .poll(
        () => withSystem((tx) => tx.outboxEmail.findUnique({ where: { id: outboxId } }), prisma),
        { timeout: 20_000, interval: 250 },
      )
      .toMatchObject({ status: 'sent' });
    expect(sent).toHaveLength(1);
  } finally {
    await boss.stop({ graceful: false });
  }
});
