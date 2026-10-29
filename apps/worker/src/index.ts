import { logger } from '@kinetic/core';
import { prisma } from '@kinetic/db';
import { createEmailPort } from './adapters';
import { createBoss } from './boss';
import { startHealthServer } from './health';
import { EMAIL_POLL_INTERVAL_MS, emailDeliverJob, pollPendingEmails } from './jobs/emailDeliver';
import { registerJobs } from './jobs/registry';
import { initSentry, Sentry } from './sentry';

const errMessage = (error: unknown) => (error instanceof Error ? error.message : 'unknown');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  initSentry();

  const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 8081);
  const health = await startHealthServer(port);

  const boss = createBoss(url);
  boss.on('error', (error) => {
    logger.error({ err: errMessage(error) }, 'pg-boss error');
    Sentry.captureException(error);
  });
  await boss.start();
  await registerJobs(boss, [emailDeliverJob], { prisma, port: createEmailPort(), logger });

  const poll = () =>
    pollPendingEmails({ prisma, sender: boss, logger }).catch((error: unknown) => {
      logger.error({ err: errMessage(error) }, 'poll failed');
      Sentry.captureException(error);
    });
  await poll();
  const timer = setInterval(() => void poll(), EMAIL_POLL_INTERVAL_MS);
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
