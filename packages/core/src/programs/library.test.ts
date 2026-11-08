import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { assignProgram } from '../assignments/assign';
import { createProgram, getProgram, listPrograms } from './read';
import { copyTitle, duplicateTemplate, setTemplateArchived } from './library';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('template library (PRD C13)', () => {
  it('duplicates the current version into a new template; the source and its clients are untouched', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const copy = await runAs(prisma, w.coach, (tx) => duplicateTemplate(tx, w.coach, w.templateId));
    expect(copy).toMatchObject({ title: 'Copy of Block', versionNo: 1, activeClientCount: 0 });
    const [src, dup] = await runAs(prisma, w.coach, async (tx) => [
      await getProgram(tx, w.coach, w.templateId),
      await getProgram(tx, w.coach, copy.id),
    ]);
    expect(dup!.weeks).toEqual(src!.weeks);
    expect(dup!.id).not.toBe(src!.id);
    const list = await runAs(prisma, w.coach, (tx) =>
      listPrograms(tx, w.coach, { kind: 'template' }),
    );
    expect(list.items.find((p) => p.id === w.templateId)?.activeClientCount).toBe(1);
  });

  it('a never-saved template duplicates to an empty one; long titles are cut', async () => {
    const org = await newOrg(prisma);
    const empty = await runAs(prisma, org.coach, (tx) =>
      createProgram(tx, org.coach, { title: 'Draft idea' }),
    );
    const copy = await runAs(prisma, org.coach, (tx) => duplicateTemplate(tx, org.coach, empty.id));
    expect(copy).toMatchObject({ title: 'Copy of Draft idea', versionNo: null });
    expect(copyTitle('x'.repeat(120))).toHaveLength(120);
  });

  it('search finds titles case-insensitively and treats % and _ literally', async () => {
    const org = await newOrg(prisma);
    for (const title of ['Upper/Lower 4-day', 'Full body 100%', 'Glute focus']) {
      await runAs(prisma, org.coach, (tx) => createProgram(tx, org.coach, { title }));
    }
    const find = (q: string) =>
      runAs(prisma, org.coach, (tx) => listPrograms(tx, org.coach, { kind: 'template', q })).then(
        (r) => r.items.map((p) => p.title),
      );
    expect(await find('upper')).toEqual(['Upper/Lower 4-day']);
    expect(await find('100%')).toEqual(['Full body 100%']);
    expect(await find('%')).toEqual(['Full body 100%']);
    await expect(find('')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('archive hides a template, blocks new assignments and keeps running copies; restore brings it back', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) => setTemplateArchived(tx, w.coach, w.templateId, true));
    const active = await runAs(prisma, w.coach, (tx) =>
      listPrograms(tx, w.coach, { kind: 'template' }),
    );
    expect(active.items.map((p) => p.id)).not.toContain(w.templateId);
    const archived = await runAs(prisma, w.coach, (tx) =>
      listPrograms(tx, w.coach, { kind: 'template', status: 'archived' }),
    );
    expect(archived.items.map((p) => p.id)).toEqual([w.templateId]);
    await expect(
      runAs(prisma, w.coach, (tx) =>
        assignProgram(
          tx,
          w.coach,
          {
            clientId: w.clientId,
            templateProgramId: w.templateId,
            startLocalDate: '2026-11-20',
            weekdays: [1, 3, 5],
            readinessConfirmed: true,
            confirmReplace: true,
          },
          { now: NOW },
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // The client's running copy is a separate program and stays assigned.
    const running = await runAs(prisma, w.coach, (tx) =>
      tx.programAssignment.count({ where: { clientId: w.clientId, status: 'active' } }),
    );
    expect(running).toBe(1);
    // Repeating is a no-op; restore puts it back.
    await runAs(prisma, w.coach, (tx) => setTemplateArchived(tx, w.coach, w.templateId, true));
    await runAs(prisma, w.coach, (tx) => setTemplateArchived(tx, w.coach, w.templateId, false));
    const back = await runAs(prisma, w.coach, (tx) =>
      listPrograms(tx, w.coach, { kind: 'template' }),
    );
    expect(back.items.map((p) => p.id)).toContain(w.templateId);
  });

  it('client copies, other orgs and clients are refused', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newOrg(prisma);
    await expect(
      runAs(prisma, w.coach, (tx) => duplicateTemplate(tx, w.coach, w.clientProgramId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, other.coach, (tx) => setTemplateArchived(tx, other.coach, w.templateId, true)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, w.client, (tx) => duplicateTemplate(tx, w.client, w.templateId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
