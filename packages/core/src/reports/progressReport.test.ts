import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { recordMetric } from '../progress/metrics';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { TINY_JPEG } from './tinyJpeg.test-helpers';
import {
  deleteProgressReport,
  listProgressReports,
  progressReportData,
  renderProgressReport,
  saveProgressReport,
} from './progressReport';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-20T15:00:00Z');

describe('monthly progress report (PRD E10)', () => {
  it('collects the month, messages the client once, and renders a PDF', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org, { startLocalDate: '2026-11-20', now: NOW });
    for (const [on, kg] of [
      ['2026-10-28', 82],
      ['2026-11-05', 81.4],
      ['2026-11-19', 80.2],
    ] as const) {
      await runAs(prisma, w.client, (tx) =>
        recordMetric(
          tx,
          w.client,
          w.clientId,
          { metric: 'weight', measuredOn: on, value: kg },
          { now: NOW },
        ),
      );
    }
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveProgressReport(tx, org.coach, { clientId: w.clientId, month: '2026-12' }, { now: NOW }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const r = await runAs(prisma, org.coach, (tx) =>
      saveProgressReport(
        tx,
        org.coach,
        {
          clientId: w.clientId,
          month: '2026-11',
          summary: 'Great month: consistent training and steady weight loss.',
          includePhotos: true,
        },
        { now: NOW },
      ),
    );
    expect(r).toMatchObject({ created: true, monthLabel: 'November 2026' });
    const again = await runAs(prisma, org.coach, (tx) =>
      saveProgressReport(
        tx,
        org.coach,
        { clientId: w.clientId, month: '2026-11', summary: 'Edited summary.' },
        { now: NOW },
      ),
    );
    expect(again).toMatchObject({ id: r.id, created: false, summary: 'Edited summary.' });
    const messages = await withSystem(
      (tx) =>
        tx.message.findMany({
          where: { thread: { is: { clientId: w.clientId } } },
          select: { body: true },
        }),
      prisma,
    );
    expect(messages.filter((m) => m.body.includes('progress report'))).toHaveLength(1);

    expect(await runAs(prisma, w.client, (tx) => listProgressReports(tx, w.client))).toMatchObject([
      { id: r.id, month: '2026-11' },
    ]);
    const data = await runAs(prisma, w.client, (tx) => progressReportData(tx, w.client, r.id, NOW));
    expect(data).toMatchObject({
      monthLabel: 'November 2026',
      summary: 'Edited summary.',
      metrics: [{ label: 'Body weight', start: '82 kg', end: '80.2 kg', change: '-1.8 kg' }],
    });
    expect(data.workouts.planned).toBeGreaterThan(0);

    const pdf = renderProgressReport(
      { ...data, photos: [{ storageKey: 'k', contentType: 'image/jpeg', label: 'Front' }] },
      new Map([['k', TINY_JPEG]]),
    );
    const text = Array.from(pdf, (c) => String.fromCharCode(c)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/DCTDecode');

    // Another client can't open it.
    const other = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, other.client, (tx) => progressReportData(tx, other.client, r.id, NOW)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await runAs(prisma, org.coach, (tx) => deleteProgressReport(tx, org.coach, r.id));
    expect(await runAs(prisma, w.client, (tx) => listProgressReports(tx, w.client))).toEqual([]);
  });
});
