import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createFsStorage, type StoragePort } from '@kinetic/storage';
import { buildExports, purgeExpiredExports } from './exportsBuild';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let dir: string;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  dir = await mkdtemp(join(tmpdir(), 'kinetic-exports-'));
});
afterAll(async () => {
  await drop();
  await rm(dir, { recursive: true, force: true });
});

async function queuedOrgExport(): Promise<{ orgId: string; jobId: string }> {
  return withSystem(async (tx) => {
    const u = await tx.user.create({
      data: { email: `o-${crypto.randomUUID()}@example.test`, name: 'O' },
    });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: u.id },
    });
    await tx.membership.create({ data: { userId: u.id, organizationId: org.id, role: 'owner' } });
    const job = await tx.exportJob.create({
      data: {
        organizationId: org.id,
        requestedBy: u.id,
        scope: 'org',
        idempotencyKey: crypto.randomUUID(),
      },
    });
    return { orgId: org.id, jobId: job.id };
  }, prisma);
}

describe('buildExports', () => {
  it('builds queued exports into storage once (run x2)', async () => {
    const { orgId, jobId } = await queuedOrgExport();
    const storage = createFsStorage(dir);
    const now = new Date('2026-11-04T12:00:00Z');
    expect(await buildExports(prisma, storage, now)).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(await buildExports(prisma, storage, now)).toEqual({ done: 0, retried: 0, failed: 0 });
    const files = await readdir(join(dir, 'exports', orgId, jobId, 'a1'));
    expect(files.sort()).toEqual([
      'checkins.csv',
      'clients.csv',
      'exercise_swaps.csv',
      'habits.csv',
      'metrics.csv',
      'nutrition.csv',
      'sessions.csv',
      'set_logs.csv',
    ]);
    const job = await withSystem(
      (tx) => tx.exportJob.findUniqueOrThrow({ where: { id: jobId } }),
      prisma,
    );
    expect(job.status).toBe('done');
  });

  it('a storage failure is retried and ends failed after three attempts', async () => {
    const { jobId } = await queuedOrgExport();
    const broken: StoragePort = {
      put: async () => {
        throw new Error('unavailable');
      },
      read: async () => null,
      deleteMany: async () => undefined,
    };
    const now = new Date('2026-11-04T12:00:00Z');
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push(await buildExports(prisma, broken, now));
    expect(outcomes.map((o) => [o.retried, o.failed])).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
    const job = await withSystem(
      (tx) => tx.exportJob.findUniqueOrThrow({ where: { id: jobId } }),
      prisma,
    );
    expect(job).toMatchObject({ status: 'failed', filesJson: null, attempts: 3 });
  });
});

describe('purgeExpiredExports (PR #2 review D-I4)', () => {
  it('removes the files of expired exports once, and retries after a storage failure', async () => {
    const { orgId, jobId } = await queuedOrgExport();
    const storage = createFsStorage(dir);
    // Later than the other tests' exports, which this first purge removes.
    const built = new Date('2027-01-04T12:00:00Z');
    await buildExports(prisma, storage, built);
    expect(await readdir(join(dir, 'exports', orgId, jobId, 'a1'))).toHaveLength(8);
    await purgeExpiredExports(prisma, storage, built);

    // Not expired yet: nothing happens.
    expect(await purgeExpiredExports(prisma, storage, built)).toEqual({ purged: 0, failed: 0 });

    const later = new Date(built.getTime() + 8 * 86_400_000);
    const broken: StoragePort = {
      put: async () => undefined,
      read: async () => null,
      deleteMany: async () => {
        throw new Error('unavailable');
      },
    };
    const errors: unknown[] = [];
    expect(
      await purgeExpiredExports(prisma, broken, later, {
        error: (o: unknown) => void errors.push(o),
      }),
    ).toEqual({ purged: 0, failed: 1 });
    expect(errors).toEqual([{ exportJobId: jobId, errName: 'Error' }]);

    expect(await purgeExpiredExports(prisma, storage, later)).toEqual({ purged: 1, failed: 0 });
    expect(await readdir(join(dir, 'exports', orgId, jobId, 'a1'))).toEqual([]);
    expect(await purgeExpiredExports(prisma, storage, later)).toEqual({ purged: 0, failed: 0 });
    const job = await withSystem(
      (tx) => tx.exportJob.findUniqueOrThrow({ where: { id: jobId } }),
      prisma,
    );
    expect(job.purgedAt).toEqual(later);
  });

  it('a build whose claim was lost (an erasure re-queued it) records nothing and removes its files', async () => {
    const { orgId, jobId } = await queuedOrgExport();
    const now = new Date('2026-11-04T12:00:00Z');
    const storage = createFsStorage(dir);
    // Re-queue the job while its files are being written, as an erasure does.
    const racing: StoragePort = {
      ...storage,
      put: async (key, body, type) => {
        await storage.put(key, body, type);
        await withSystem(
          (tx) =>
            tx.exportJob.updateMany({
              where: { id: jobId },
              data: { status: 'queued', claimedAt: null },
            }),
          prisma,
        );
      },
    };
    expect(await buildExports(prisma, racing, now)).toEqual({ done: 0, retried: 0, failed: 0 });
    expect(await readdir(join(dir, 'exports', orgId, jobId, 'a1')).catch(() => [])).toEqual([]);
    const job = await withSystem(
      (tx) => tx.exportJob.findUniqueOrThrow({ where: { id: jobId } }),
      prisma,
    );
    expect(job.status).toBe('queued');
  });
});
