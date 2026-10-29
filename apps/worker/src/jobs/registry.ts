import type { PgBoss, Queue } from 'pg-boss';
import type { EmailPort, Logger } from '@kinetic/core';
import type { PrismaClient } from '@kinetic/db';

export interface JobDeps {
  prisma: PrismaClient;
  port: EmailPort;
  logger: Logger;
}

export interface JobDefinition<T extends object> {
  name: string;
  queue?: Omit<Queue, 'name'>;
  handle(data: T, deps: JobDeps): Promise<void>;
}

export function defineJob<T extends object>(definition: JobDefinition<T>): JobDefinition<T> {
  return definition;
}

/** Registers every job's queue and worker. A throwing handler makes pg-boss retry. */
export async function registerJobs(
  boss: PgBoss,
  jobs: ReadonlyArray<JobDefinition<never>>,
  deps: JobDeps,
): Promise<void> {
  for (const job of jobs) {
    const handle = job.handle as (data: object, deps: JobDeps) => Promise<void>;
    await boss.createQueue(job.name, job.queue);
    await boss.work<object>(job.name, async (batch) => {
      for (const { data } of batch) await handle(data, deps);
    });
  }
}
