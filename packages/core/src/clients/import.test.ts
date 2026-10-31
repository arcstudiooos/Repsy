import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { importClients, IMPORT_MAX_ROWS } from './import';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('client import (PRD B17)', () => {
  it('dry run reports per-row problems and writes nothing; a real run creates the good rows', async () => {
    const org = await newOrg(prisma);
    const existing = await newClientWorld(prisma, org);
    const takenEmail = await runAs(
      prisma,
      org.coach,
      async (tx) => (await tx.client.findFirstOrThrow({ where: { id: existing.clientId } })).email,
    );
    const rows = [
      { name: ' Ana Silva ', email: 'ANA@example.test', units: 'lbs', timezone: 'Europe/Lisbon' },
      { name: '', email: 'blank@example.test' },
      { name: 'Bad Email', email: 'nope' },
      { name: 'Taken', email: takenEmail.toUpperCase() },
      { name: 'Ana again', email: 'ana@example.test' },
      { name: 'Zone', email: 'zone@example.test', timezone: 'Mars/Olympus' },
      { name: 'Units', email: 'units@example.test', units: 'stone' },
      { name: 'Ben', email: 'ben@example.test', goals: 'Run a 10k' },
    ];
    const dry = await runAs(prisma, org.coach, (tx) =>
      importClients(tx, org.coach, { rows, dryRun: true }),
    );
    expect(dry).toMatchObject({ dryRun: true, created: 2, skipped: 6 });
    expect(dry.rows.map((r) => [r.row, r.ok, r.error])).toEqual([
      [1, true, null],
      [2, false, 'Name must be 1-120 characters.'],
      [3, false, 'Email is not valid.'],
      [4, false, 'A client with this email already exists.'],
      [5, false, 'This email appears earlier in the file.'],
      [6, false, 'Unknown time zone "Mars/Olympus".'],
      [7, false, 'Units must be kg or lb.'],
      [8, true, null],
    ]);
    expect(dry.rows.every((r) => r.clientId === null)).toBe(true);
    expect(
      await runAs(prisma, org.coach, (tx) =>
        tx.client.count({ where: { email: { in: ['ana@example.test', 'ben@example.test'] } } }),
      ),
    ).toBe(0);

    const real = await runAs(prisma, org.coach, (tx) => importClients(tx, org.coach, { rows }));
    expect(real).toMatchObject({ dryRun: false, created: 2, skipped: 6 });
    const ana = await runAs(prisma, org.coach, (tx) =>
      tx.client.findFirstOrThrow({ where: { email: 'ana@example.test' } }),
    );
    expect(ana).toMatchObject({
      id: real.rows[0]!.clientId,
      name: 'Ana Silva',
      status: 'invited',
      preferredUnits: 'lb',
      timezone: 'Europe/Lisbon',
      coachUserId: org.coach.userId,
    });
    const ben = await runAs(prisma, org.coach, (tx) =>
      tx.client.findFirstOrThrow({ where: { email: 'ben@example.test' } }),
    );
    // Org zone by default; no invite is sent.
    expect(ben).toMatchObject({
      goals: 'Run a 10k',
      timezone: 'America/New_York',
      preferredUnits: 'kg',
    });
    expect(
      await runAs(prisma, org.coach, (tx) =>
        tx.clientInvite.count({ where: { clientId: ben.id } }),
      ),
    ).toBe(0);

    // Re-importing the same file skips everything already there.
    const again = await runAs(prisma, org.coach, (tx) => importClients(tx, org.coach, { rows }));
    expect(again.created).toBe(0);
  });

  it('stops at the active-client limit, row by row', async () => {
    const org = await newOrg(prisma);
    await withSystem(
      (tx) => tx.organization.update({ where: { id: org.orgId }, data: { activeClientLimit: 2 } }),
      prisma,
    );
    await newClientWorld(prisma, org);
    const res = await runAs(prisma, org.coach, (tx) =>
      importClients(tx, org.coach, {
        rows: [
          { name: 'A', email: 'a@example.test' },
          { name: 'B', email: 'b@example.test' },
        ],
      }),
    );
    expect(res.rows.map((r) => [r.ok, r.error])).toEqual([
      [true, null],
      [false, 'Over your limit of 2 active clients.'],
    ]);
  });

  it('rejects empty or oversized files and non-coach actors', async () => {
    const org = await newOrg(prisma);
    const world = await newClientWorld(prisma, org);
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    expect(
      await code(runAs(prisma, org.coach, (tx) => importClients(tx, org.coach, { rows: [] }))),
    ).toBe('VALIDATION');
    const many = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({
      name: `C${i}`,
      email: `c${i}@example.test`,
    }));
    expect(
      await code(runAs(prisma, org.coach, (tx) => importClients(tx, org.coach, { rows: many }))),
    ).toBe('VALIDATION');
    expect(
      await code(
        runAs(prisma, world.client, (tx) =>
          importClients(tx, world.client, { rows: [{ name: 'X', email: 'x@example.test' }] }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });
});
