import type { PgBoss, Queue } from 'pg-boss';
import type { EmailPort, Logger } from '@kinetic/core';
import type { PrismaClient } from '@kinetic/db';

/** Error reporter (Sentry.captureException in the worker; a no-op without SENTRY_DSN). */
export type CaptureException = (error: unknown, context?: Record<string, unknown>) => void;

export interface JobDeps {
  prisma: PrismaClient;
  port: EmailPort;
  logger: Logger;
  captureException?: CaptureException;
}

export interface JobDefinition<T extends object> {
  name: string;
  queue?: Omit<Queue, 'name'>;
  /** pg-boss cron expression (UTC): the job is also queued on this schedule. */
  cron?: string;
  handle(data: T, deps: JobDeps): Promise<void>;
}

export function defineJob<T extends object>(definition: JobDefinition<T>): JobDefinition<T> {
  return definition;
}

/**
 * Registers every job's queue, worker and schedule (if any). A throwing handler is reported via
 * captureException, then rethrown so pg-boss retries.
 */
export async function registerJobs(
  boss: PgBoss,
  jobs: ReadonlyArray<JobDefinition<never>>,
  deps: JobDeps,
): Promise<void> {
  for (const job of jobs) {
    const handle = job.handle as (data: object, deps: JobDeps) => Promise<void>;
    await boss.createQueue(job.name, job.queue);
    await boss.work<object>(job.name, async (batch) => {
      for (const { data } of batch) {
        try {
          await handle(data, deps);
        } catch (error) {
          deps.captureException?.(error, { job: job.name });
          throw error;
        }
      }
    });
    if (job.cron) await boss.schedule(job.name, job.cron);
  }
}
