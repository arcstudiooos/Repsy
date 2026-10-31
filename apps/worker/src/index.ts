import { logger } from '@kinetic/core';
import { assertRuntimeRoleIfEnforced, prisma } from '@kinetic/db';
import { createEmailPort } from './adapters';
import { createAnalytics } from './adapters/analytics';
import { createBoss, pgBossSchemaIsPrecreated } from './boss';
import { outboxPollIntervalMs } from './config';
import { startHealthServer } from './health';
import { jobs } from './jobs/all';
import { queueEmailSweep } from './jobs/emailDeliver';
import { registerJobs } from './jobs/registry';
import { initSentry, Sentry } from './sentry';

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'unknown');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  initSentry();
  // Fails fast in production when RESEND_API_KEY / EMAIL_FROM are missing.
  const emailPort = createEmailPort();
  await assertRuntimeRoleIfEnforced(prisma);

  const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 8081);
  const health = await startHealthServer(port);

  const boss = createBoss(url, { precreated: pgBossSchemaIsPrecreated() });
  boss.on('error', (error) => {
    logger.error({ err: errMessage(error) }, 'pg-boss error');
    Sentry.captureException(error);
  });
  await boss.start();
  const captureException = (error: unknown, context?: Record<string, unknown>) => {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  };
  await registerJobs(boss, jobs, {
    prisma,
    port: emailPort,
    logger,
    captureException,
    analytics: createAnalytics(),
  });

  const intervalMs = outboxPollIntervalMs();
  const poll = () =>
    queueEmailSweep(boss, intervalMs).catch((error: unknown) => {
      logger.error({ err: errMessage(error) }, 'poll failed');
      Sentry.captureException(error);
    });
  await poll();
  const timer = setInterval(() => void poll(), intervalMs);
  logger.info({ port }, 'worker started');

  const shutdown = async () => {
    clearInterval(timer);
    health.close();
    await boss.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  logger.fatal({ err: errMessage(error) }, 'worker crashed');
  Sentry.captureException(error);
  process.exit(1);
});
