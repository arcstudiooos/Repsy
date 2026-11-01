import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  acceptAgreement,
  acceptancesFor,
  createAgreement,
  pendingAgreements,
  updateAgreement,
} from './agreements';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const TEXT = 'I take part at my own risk and will tell my coach about any injury.';

describe('agreements and waivers (PRD B14)', () => {
  it('a client accepts the version shown; a changed text asks again', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const a = await runAs(prisma, org.coach, (tx) =>
      createAgreement(tx, org.coach, { title: 'Waiver', body: TEXT }),
    );
    const pending = () => runAs(prisma, w.client, (tx) => pendingAgreements(tx, w.client));
    expect((await pending()).map((x) => x.id)).toEqual([a.id]);
    await runAs(prisma, w.client, (tx) =>
      acceptAgreement(tx, w.client, a.id, { version: 1, ip: '203.0.113.7' }),
    );
    expect(await pending()).toEqual([]);
    // A title-only change keeps the version.
    expect(
      (
        await runAs(prisma, org.coach, (tx) =>
          updateAgreement(tx, org.coach, a.id, { title: 'Liability waiver', body: TEXT }),
        )
      ).version,
    ).toBe(1);
    const v2 = await runAs(prisma, org.coach, (tx) =>
      updateAgreement(tx, org.coach, a.id, { title: 'Liability waiver', body: `${TEXT} Updated.` }),
    );
    expect(v2.version).toBe(2);
    expect((await pending()).map((x) => x.version)).toEqual([2]);
    // Accepting what was on screen before the change is refused.
    await expect(
      runAs(prisma, w.client, (tx) => acceptAgreement(tx, w.client, a.id, { version: 1 })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await runAs(prisma, w.client, (tx) => acceptAgreement(tx, w.client, a.id, { version: 2 }));
    const status = await runAs(prisma, org.coach, (tx) => acceptancesFor(tx, w.clientId));
    expect(status).toMatchObject([{ version: 2, acceptedVersion: 2 }]);
    const rows = await withSystem(
      (tx) => tx.agreementAcceptance.findMany({ orderBy: { version: 'asc' } }),
      prisma,
    );
    expect(rows.map((r) => [r.version, r.ip])).toEqual([
      [1, '203.0.113.7'],
      [2, null],
    ]);
    // Evidence is insert-only.
    await expect(
      withSystem(
        (tx) => tx.agreementAcceptance.update({ where: { id: rows[0]!.id }, data: { ip: 'x' } }),
        prisma,
      ),
    ).rejects.toThrow(/insert-only/);
  });

  it('only the owner publishes; only the client accepts', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const coach = { ...org.coach, role: 'coach' as const };
    await expect(
      runAs(prisma, coach, (tx) => createAgreement(tx, coach, { title: 'Terms', body: TEXT })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const a = await runAs(prisma, org.coach, (tx) =>
      createAgreement(tx, org.coach, { title: 'Terms', body: TEXT }),
    );
    await expect(
      runAs(prisma, org.coach, (tx) => acceptAgreement(tx, org.coach, a.id, { version: 1 })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    void w;
  });
});
