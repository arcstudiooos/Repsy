import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { runDeletions } from './deletionsRun';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-04T12:00:00Z');

/** A verified deletion request for a new client; `blocked` adds a row erasure cannot remove (an FK RESTRICT). */
async function verifiedRequest(opts: { blocked?: boolean; verifiedAt: Date }): Promise<string> {
  return withSystem(async (tx) => {
    const owner = await tx.user.create({
      data: { email: `o-${crypto.randomUUID()}@example.test`, name: 'O' },
    });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: owner.id },
    });
    const client = await tx.client.create({
      data: {
        organizationId: org.id,
        coachUserId: owner.id,
        name: 'C',
        email: `c-${crypto.randomUUID()}@example.test`,
        timezone: 'UTC',
      },
    });
    if (opts.blocked) {
      const copy = await tx.program.create({
        data: {
          organizationId: org.id,
          title: 'Copy',
          kind: 'client',
          clientId: client.id,
          createdBy: owner.id,
        },
      });
      await tx.program.create({
        data: {
          organizationId: org.id,
          title: 'Made from the copy',
          sourceProgramId: copy.id,
          createdBy: owner.id,
        },
      });
    }
    const req = await tx.deletionRequest.create({
      data: {
        organizationId: org.id,
        subjectClientId: client.id,
        requestedBy: owner.id,
        status: 'verified',
        verifiedAt: opts.verifiedAt,
      },
    });
    return req.id;
  }, prisma);
}

const statusOf = (id: string) =>
  withSystem((tx) => tx.deletionRequest.findUniqueOrThrow({ where: { id } }), prisma);

describe('runDeletions (PR #2 review C-I1)', () => {
  it('a failing request is recorded and reported, later requests still run, and it moves to the back', async () => {
    const bad = await verifiedRequest({
      blocked: true,
      verifiedAt: new Date(NOW.getTime() - 60_000),
    });
    const good = await verifiedRequest({ verifiedAt: NOW });
    const errors: unknown[] = [];
    const reported: unknown[] = [];
    const logger = { error: (obj: unknown) => void errors.push(obj) };
    const r = await runDeletions(prisma, NOW, logger, (e) => void reported.push(e));
    expect(r).toEqual({ done: 1, held: 0, failed: 1 });
    expect(await statusOf(good)).toMatchObject({ status: 'done' });
    const failed = await statusOf(bad);
    expect(failed).toMatchObject({ status: 'verified', attempts: 1 });
    expect(failed.lastErrorCode).toBeTruthy();
    expect(errors).toEqual([{ deletionRequestId: bad, errName: failed.lastErrorCode }]);
    expect(reported).toHaveLength(1);
    // Only the error class reaches the reporter, never a database message (it can quote row values).
    expect(String((reported[0] as Error).message)).toBe(`erasure failed: ${failed.lastErrorCode}`);

    // A request verified after the failing one runs first next time.
    const next = await verifiedRequest({ verifiedAt: new Date(NOW.getTime() + 60_000) });
    expect(await runDeletions(prisma, NOW)).toEqual({ done: 1, held: 0, failed: 1 });
    expect(await statusOf(next)).toMatchObject({ status: 'done' });
    expect(await statusOf(bad)).toMatchObject({ status: 'verified', attempts: 2 });
  });
});
