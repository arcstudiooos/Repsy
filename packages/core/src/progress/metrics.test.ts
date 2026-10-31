import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  listMetrics,
  metricFromCanonical,
  metricToCanonical,
  metricUnit,
  recordMetric,
} from './metrics';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** 2026-11-12 in New York (the fixture time zone). */
const NOW = new Date('2026-11-12T17:00:00Z');

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; fieldErrors?: Record<string, string[]> }) =>
      `${e.code}:${Object.keys(e.fieldErrors ?? {}).join(',')}`,
  );

const setUnits = (clientId: string, units: 'kg' | 'lb') =>
  withSystem(
    (tx) => tx.client.update({ where: { id: clientId }, data: { preferredUnits: units } }),
    prisma,
  );

describe('units', () => {
  it('lb users type pounds and inches; stored canonically', () => {
    expect(metricUnit('mass', 'lb')).toBe('lb');
    expect(metricUnit('length', 'lb')).toBe('in');
    expect(metricUnit('length', 'kg')).toBe('cm');
    expect(metricToCanonical('mass', 180, 'lb')).toBe(81.647);
    expect(metricFromCanonical('mass', 81.647, 'lb')).toBe(180);
    expect(metricFromCanonical('mass', 81.647, 'kg')).toBe(81.6);
    expect(metricToCanonical('length', 32, 'lb')).toBe(81.28);
    expect(metricFromCanonical('length', 81.28, 'lb')).toBe(32);
    expect(metricFromCanonical('count', 8123.4, 'kg')).toBe(8123);
  });
});

describe('recordMetric', () => {
  it('client records in their units; the coach sees the same canonical value', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await setUnits(w.clientId, 'lb');
    const entry = await runAs(prisma, w.client, (tx) =>
      recordMetric(
        tx,
        w.client,
        w.clientId,
        { metric: 'weight', measuredOn: '2026-11-12', value: 180 },
        { now: NOW },
      ),
    );
    expect(entry).toMatchObject({ value: 81.647, source: 'client', edited: false });
    const view = await runAs(prisma, w.coach, (tx) =>
      listMetrics(tx, w.coach, w.clientId, { now: NOW }),
    );
    expect(view.units).toBe('lb');
    expect(view.todayLocalDate).toBe('2026-11-12');
    expect(view.series).toEqual([{ metric: 'weight', entries: [entry] }]);
  });

  it('one value per day: same value replays as a no-op; a change adds a revision', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const write = (value: number) =>
      runAs(prisma, w.client, (tx) =>
        recordMetric(
          tx,
          w.client,
          w.clientId,
          { metric: 'waist', measuredOn: '2026-11-10', value },
          { now: NOW },
        ),
      );
    const a = await write(80);
    const b = await write(80);
    expect(b).toEqual(a);
    const c = await write(79.5);
    expect(c).toMatchObject({ id: a.id, value: 79.5, edited: true });
    const revisions = await withSystem((tx) => tx.metricEntryRevision.findMany(), prisma);
    expect(revisions.filter((r) => r.entryId === a.id)).toHaveLength(1);
  });

  it('a coach changing a value must give a reason', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const input = { metric: 'weight', measuredOn: '2026-11-11', value: 70 };
    await runAs(prisma, w.client, (tx) =>
      recordMetric(tx, w.client, w.clientId, input, { now: NOW }),
    );
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) =>
          recordMetric(tx, w.coach, w.clientId, { ...input, value: 7 * 10 + 1 }, { now: NOW }),
        ),
      ),
    ).toBe('VALIDATION:reason');
    const fixed = await runAs(prisma, w.coach, (tx) =>
      recordMetric(
        tx,
        w.coach,
        w.clientId,
        { ...input, value: 71, reason: 'Scale was off' },
        { now: NOW },
      ),
    );
    expect(fixed).toMatchObject({ value: 71, source: 'coach', edited: true });
  });

  it('validates metric, date and range', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const run = (input: Record<string, unknown>) =>
      codeOf(
        runAs(prisma, w.client, (tx) =>
          recordMetric(
            tx,
            w.client,
            w.clientId,
            { metric: 'weight', measuredOn: '2026-11-12', value: 70, ...input },
            { now: NOW },
          ),
        ),
      );
    expect(await run({ metric: 'blood_glucose' })).toBe('VALIDATION:metric');
    expect(await run({ measuredOn: '2026-11-13' })).toBe('VALIDATION:measuredOn');
    expect(await run({ measuredOn: '2026-02-30' })).toBe('VALIDATION:measuredOn');
    expect(await run({ measuredOn: '2010-01-01' })).toBe('VALIDATION:measuredOn');
    expect(await run({ value: 5 })).toBe('VALIDATION:value');
    expect(await run({ value: '70' })).toBe('VALIDATION:value');
    expect(await run({ value: Number.NaN })).toBe('VALIDATION:value');
    expect(await run({})).toBe('ok');
  });

  it('a client reaches only their own record; other orgs read as not found', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, await newOrg(prisma));
    const input = { metric: 'steps', measuredOn: '2026-11-12', value: 9000 };
    expect(
      await codeOf(
        runAs(prisma, a.client, (tx) =>
          recordMetric(tx, a.client, b.clientId, input, { now: NOW }),
        ),
      ),
    ).toBe('NOT_FOUND:');
    expect(
      await codeOf(runAs(prisma, a.client, (tx) => listMetrics(tx, a.client, b.clientId))),
    ).toBe('NOT_FOUND:');
    expect(
      await codeOf(
        runAs(prisma, a.coach, (tx) =>
          recordMetric(tx, a.coach, other.clientId, input, { now: NOW }),
        ),
      ),
    ).toBe('NOT_FOUND:');
  });

  it('revisions are append-only in the database', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const write = (value: number) =>
      runAs(prisma, w.client, (tx) =>
        recordMetric(
          tx,
          w.client,
          w.clientId,
          { metric: 'arm', measuredOn: '2026-11-12', value },
          { now: NOW },
        ),
      );
    const entry = await write(35);
    await write(36);
    await expect(
      withSystem(
        (tx) => tx.metricEntryRevision.deleteMany({ where: { entryId: entry.id } }),
        prisma,
      ),
    ).rejects.toThrow(/append-only/);
  });
});
