import { describe, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import type { JobDeps } from './registry';
import { defineJob, registerJobs } from './registry';

function fakeBoss() {
  const workers = new Map<string, (batch: Array<{ data: object }>) => Promise<void>>();
  const boss = {
    createQueue: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
    work: vi.fn(
      async (name: string, handler: (batch: Array<{ data: object }>) => Promise<void>) => {
        workers.set(name, handler);
        return 'worker-id';
      },
    ),
  };
  return { boss: boss as unknown as PgBoss, workers, schedule: boss.schedule };
}

describe('registerJobs', () => {
  it('reports a handler error and rethrows it so pg-boss can retry', async () => {
    const boom = new Error('boom');
    const job = defineJob<object>({
      name: 'test.fail',
      handle: async () => {
        throw boom;
      },
    });
    const captureException = vi.fn();
    const { boss, workers } = fakeBoss();
    await registerJobs(boss, [job], { captureException } as unknown as JobDeps);
    await expect(workers.get('test.fail')?.([{ data: {} }])).rejects.toBe(boom);
    expect(captureException).toHaveBeenCalledWith(boom, { job: 'test.fail' });
  });

  it('does not report successful jobs', async () => {
    const job = defineJob<object>({ name: 'test.ok', handle: async () => undefined });
    const captureException = vi.fn();
    const { boss, workers } = fakeBoss();
    await registerJobs(boss, [job], { captureException } as unknown as JobDeps);
    await workers.get('test.ok')?.([{ data: {} }]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('schedules a job that has a cron expression, and only that one', async () => {
    const cron = defineJob<object>({
      name: 'test.cron',
      cron: '*/10 * * * *',
      handle: async () => undefined,
    });
    const plain = defineJob<object>({ name: 'test.plain', handle: async () => undefined });
    const { boss, schedule } = fakeBoss();
    await registerJobs(boss, [cron, plain], {} as JobDeps);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('test.cron', '*/10 * * * *');
  });
});
