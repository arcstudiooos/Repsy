import type { EmailMessage, EmailPort, Logger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { defineJob } from './registry';

export const EMAIL_DELIVER = 'email.deliver';
export const EMAIL_RETRY_LIMIT = 5;
export const EMAIL_POLL_INTERVAL_MS = 30_000;
const POLL_BATCH = 100;

interface DeliverDeps {
  prisma: PrismaClient;
  port: EmailPort;
  logger: Logger;
}

interface Row {
  templateKey: string;
  payloadJson: unknown;
  idempotencyKey: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal rendering until real templates land: payload.subject/text/html, else the key. */
function render(row: Row, to: string): EmailMessage {
  const payload =
    row.payloadJson && typeof row.payloadJson === 'object' && !Array.isArray(row.payloadJson)
      ? (row.payloadJson as Record<string, unknown>)
      : {};
  const str = (key: string) => (typeof payload[key] === 'string' ? payload[key] : undefined);
  const text = str('text') ?? '';
  return {
    to,
    subject: str('subject') ?? row.templateKey,
    text,
    html: str('html') ?? `<p>${escapeHtml(text)}</p>`,
    templateKey: row.templateKey,
    payload,
    idempotencyKey: row.idempotencyKey,
  };
}

/**
 * Delivers one pending outbox row. Throws on a retryable failure (pg-boss then
 * retries with backoff); returns 'failed' once EMAIL_RETRY_LIMIT attempts are used.
 * Non-pending rows are skipped, so a re-run never double-sends.
 */
export async function deliverEmail(
  { prisma, port, logger }: DeliverDeps,
  outboxId: string,
): Promise<'sent' | 'failed' | 'skipped'> {
  const row = await withSystem(
    (tx) => tx.outboxEmail.findUnique({ where: { id: outboxId }, include: { toUser: true } }),
    prisma,
  );
  if (!row || row.status !== 'pending') return 'skipped';

  try {
    await port.send(render(row, row.toUser.email));
  } catch (error) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= EMAIL_RETRY_LIMIT;
    await withSystem(
      (tx) =>
        tx.outboxEmail.updateMany({
          where: { id: outboxId, status: 'pending' },
          data: { attempts, ...(exhausted ? { status: 'failed' as const } : {}) },
        }),
      prisma,
    );
    logger.warn(
      { outboxId, attempts, err: error instanceof Error ? error.message : 'unknown' },
      exhausted ? 'email delivery failed permanently' : 'email delivery failed, will retry',
    );
    if (exhausted) return 'failed';
    throw error;
  }

  await withSystem(
    (tx) =>
      tx.outboxEmail.updateMany({
        where: { id: outboxId, status: 'pending' },
        data: { status: 'sent', sentAt: new Date(), attempts: row.attempts + 1 },
      }),
    prisma,
  );
  logger.info({ outboxId }, 'email sent');
  return 'sent';
}

export interface JobSender {
  send(name: string, data: object, options: object): Promise<string | null>;
}

/** Queues a deliver job for each pending row (system code: reads across orgs). */
export async function pollPendingEmails({
  prisma,
  sender,
  logger,
}: {
  prisma: PrismaClient;
  sender: JobSender;
  logger: Logger;
}): Promise<number> {
  const rows = await withSystem(
    (tx) =>
      tx.outboxEmail.findMany({
        where: { status: 'pending' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: POLL_BATCH,
      }),
    prisma,
  );
  for (const { id } of rows) {
    await sender.send(
      EMAIL_DELIVER,
      { outboxId: id },
      { singletonKey: id, retryLimit: EMAIL_RETRY_LIMIT, retryBackoff: true },
    );
  }
  if (rows.length > 0) logger.debug({ count: rows.length }, 'queued pending emails');
  return rows.length;
}

export const emailDeliverJob = defineJob<{ outboxId: string }>({
  name: EMAIL_DELIVER,
  queue: { retryLimit: EMAIL_RETRY_LIMIT, retryBackoff: true },
  handle: async ({ outboxId }, deps) => {
    await deliverEmail(deps, outboxId);
  },
});
