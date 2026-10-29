import type { EmailMessage, EmailPort, Logger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { defineJob, type CaptureException } from './registry';

export const EMAIL_DELIVER = 'email.deliver';
export const EMAIL_RETRY_LIMIT = 5;
export const EMAIL_BATCH_SIZE = 25;
export const EMAIL_LEASE_MS = 5 * 60_000;
export const EMAIL_BACKOFF_BASE_MS = 30_000;

export interface DeliverDeps {
  prisma: PrismaClient;
  port: EmailPort;
  logger: Logger;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Called once per row that transitions to `failed`. */
  captureException?: CaptureException;
}

/**
 * Payloads may carry single-use links (verify / reset tokens). Once a row is
 * final (sent or failed) the payload is cleared so tokens do not persist.
 */
const CLEARED_PAYLOAD = {};

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

/** 30s, 60s, 120s, 240s after attempts 1..4. */
export const backoffMs = (attempts: number) => EMAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1);

export interface BatchResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * One sweep over the outbox (system code, all orgs). The row is the source of
 * truth for retries: a row is claimed atomically (status `sending` + lease,
 * attempts incremented), sent, then marked sent / rescheduled / failed.
 * Concurrent sweeps cannot claim the same row, so it is sent at most once
 * per attempt; the idempotencyKey covers a crash between send and mark-sent.
 */
export async function deliverDueEmails(deps: DeliverDeps): Promise<BatchResult> {
  const { prisma, port, logger } = deps;
  const clock = deps.now ?? (() => new Date());
  const result: BatchResult = { sent: 0, retried: 0, failed: 0 };
  const start = clock();
  const reportFailed = (outboxId: string, attempts: number, cause?: unknown) =>
    deps.captureException?.(
      new Error('outbox email failed permanently', cause === undefined ? undefined : { cause }),
      { outboxId, attempts },
    );

  // Reclaim expired leases: a crashed sender's attempt already counted.
  const reclaimedFailed = await withSystem(async (tx) => {
    const expired = { status: 'sending' as const, leaseUntil: { lt: start } };
    const failed = await tx.outboxEmail.updateManyAndReturn({
      where: { ...expired, attempts: { gte: EMAIL_RETRY_LIMIT } },
      data: { status: 'failed', leaseUntil: null, payloadJson: CLEARED_PAYLOAD },
      select: { id: true, attempts: true },
    });
    await tx.outboxEmail.updateMany({
      where: expired,
      data: { status: 'pending', leaseUntil: null },
    });
    return failed;
  }, prisma);
  for (const row of reclaimedFailed) {
    logger.warn({ outboxId: row.id, attempts: row.attempts }, 'email delivery failed permanently');
    reportFailed(row.id, row.attempts);
  }

  const candidates = await withSystem(
    (tx) =>
      tx.outboxEmail.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: start } },
        select: { id: true },
        orderBy: { nextAttemptAt: 'asc' },
        take: EMAIL_BATCH_SIZE,
      }),
    prisma,
  );

  for (const { id } of candidates) {
    const claimedAt = clock();
    const claimed = await withSystem(
      (tx) =>
        tx.outboxEmail.updateMany({
          where: { id, status: 'pending', nextAttemptAt: { lte: claimedAt } },
          data: {
            status: 'sending',
            leaseUntil: new Date(claimedAt.getTime() + EMAIL_LEASE_MS),
            attempts: { increment: 1 },
          },
        }),
      prisma,
    );
    if (claimed.count !== 1) continue;

    const row = await withSystem(
      (tx) => tx.outboxEmail.findUniqueOrThrow({ where: { id }, include: { toUser: true } }),
      prisma,
    );
    try {
      await port.send(render(row, row.toUser.email));
    } catch (error) {
      const exhausted = row.attempts >= EMAIL_RETRY_LIMIT;
      await withSystem(
        (tx) =>
          tx.outboxEmail.updateMany({
            where: { id, status: 'sending' },
            data: exhausted
              ? { status: 'failed', leaseUntil: null, payloadJson: CLEARED_PAYLOAD }
              : {
                  status: 'pending',
                  leaseUntil: null,
                  nextAttemptAt: new Date(clock().getTime() + backoffMs(row.attempts)),
                },
          }),
        prisma,
      );
      logger.warn(
        {
          outboxId: id,
          attempts: row.attempts,
          err: error instanceof Error ? error.message : 'unknown',
        },
        exhausted ? 'email delivery failed permanently' : 'email delivery failed, will retry',
      );
      if (exhausted) reportFailed(id, row.attempts, error);
      result[exhausted ? 'failed' : 'retried'] += 1;
      continue;
    }
    await withSystem(
      (tx) =>
        tx.outboxEmail.updateMany({
          where: { id, status: 'sending' },
          data: { status: 'sent', sentAt: clock(), leaseUntil: null, payloadJson: CLEARED_PAYLOAD },
        }),
      prisma,
    );
    logger.info({ outboxId: id }, 'email sent');
    result.sent += 1;
  }
  return result;
}

export interface JobSender {
  send(name: string, data: object, options: object): Promise<string | null>;
}

/** Queues a sweep job; sweeps are idempotent, so overlap is harmless. */
export function queueEmailSweep(sender: JobSender, intervalMs: number): Promise<string | null> {
  return sender.send(
    EMAIL_DELIVER,
    {},
    { singletonSeconds: Math.max(1, Math.floor(intervalMs / 1000)) },
  );
}

export const emailDeliverJob = defineJob<object>({
  name: EMAIL_DELIVER,
  queue: { retryLimit: 0 },
  handle: async (_data, deps) => {
    await deliverDueEmails(deps);
  },
});
