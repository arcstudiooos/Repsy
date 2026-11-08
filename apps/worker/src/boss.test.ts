import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { EmailMessage } from '@repsy/core';
import { createLogger } from '@repsy/core';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createBoss } from './boss';
import { emailDeliverJob, queueEmailSweep } from './jobs/emailDeliver';
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
it('pg-boss delivers an outbox row via a sweep job end to end', async () => {
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
    await queueEmailSweep(boss, 1000);
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
