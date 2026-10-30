import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createFsStorage, type StoragePort } from '@kinetic/storage';
import { buildExports } from './exportsBuild';

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
    const files = await readdir(join(dir, 'exports', orgId, jobId));
    expect(files.sort()).toEqual(['checkins.csv', 'clients.csv', 'sessions.csv', 'set_logs.csv']);
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
