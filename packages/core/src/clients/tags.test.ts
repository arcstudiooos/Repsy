import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { listClients } from './clients';
import { createTag, deleteTag, listTags, setClientTags, tagsForClients } from './tags';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const fieldOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; fieldErrors?: Record<string, string[]> }) =>
      `${e.code}:${Object.keys(e.fieldErrors ?? {})[0] ?? ''}`,
  );

describe('client tags (PRD B4)', () => {
  it('create, tag clients, filter the list, count, delete', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const online = await runAs(prisma, org.coach, (tx) =>
      createTag(tx, org.coach, { name: '  Online   coaching ', color: 'blue' }),
    );
    expect(online).toMatchObject({ name: 'Online coaching', color: 'blue' });
    const fat = await runAs(prisma, org.coach, (tx) =>
      createTag(tx, org.coach, { name: 'Fat loss' }),
    );
    expect(
      await runAs(prisma, org.coach, (tx) =>
        setClientTags(tx, org.coach, a.clientId, [fat.id, online.id]),
      ),
    ).toEqual([
      { id: fat.id, name: 'Fat loss', color: 'teal' },
      { id: online.id, name: 'Online coaching', color: 'blue' },
    ]);
    await runAs(prisma, org.coach, (tx) => setClientTags(tx, org.coach, b.clientId, [online.id]));
    // Replacing drops what is not listed.
    await runAs(prisma, org.coach, (tx) => setClientTags(tx, org.coach, a.clientId, [fat.id]));
    const byClient = await runAs(prisma, org.coach, (tx) =>
      tagsForClients(tx, org.coach, [a.clientId, b.clientId]),
    );
    expect(byClient.get(a.clientId)?.map((t) => t.name)).toEqual(['Fat loss']);
    expect(byClient.get(b.clientId)?.map((t) => t.name)).toEqual(['Online coaching']);
    const filtered = await runAs(prisma, org.coach, (tx) =>
      listClients(tx, org.coach, { tagId: online.id }),
    );
    expect(filtered.items.map((c) => c.id)).toEqual([b.clientId]);
    expect(
      (await runAs(prisma, org.coach, (tx) => listTags(tx, org.coach))).map((t) => [
        t.name,
        t.clientCount,
      ]),
    ).toEqual([
      ['Fat loss', 1],
      ['Online coaching', 1],
    ]);
    await runAs(prisma, org.coach, (tx) => deleteTag(tx, org.coach, online.id));
    expect(
      (await runAs(prisma, org.coach, (tx) => tagsForClients(tx, org.coach, [b.clientId]))).get(
        b.clientId,
      ),
    ).toBeUndefined();
  });

  it('validates names, colours and ids; scopes to the organization; clients are refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newOrg(prisma);
    await runAs(prisma, org.coach, (tx) => createTag(tx, org.coach, { name: 'VIP' }));
    expect(
      await fieldOf(runAs(prisma, org.coach, (tx) => createTag(tx, org.coach, { name: 'vip' }))),
    ).toBe('VALIDATION:name');
    expect(
      await fieldOf(runAs(prisma, org.coach, (tx) => createTag(tx, org.coach, { name: '' }))),
    ).toBe('VALIDATION:name');
    expect(
      await fieldOf(
        runAs(prisma, org.coach, (tx) => createTag(tx, org.coach, { name: 'x', color: 'pink' })),
      ),
    ).toBe('VALIDATION:color');
    const theirs = await runAs(prisma, other.coach, (tx) =>
      createTag(tx, other.coach, { name: 'Theirs' }),
    );
    expect(
      await fieldOf(
        runAs(prisma, org.coach, (tx) => setClientTags(tx, org.coach, w.clientId, [theirs.id])),
      ),
    ).toBe('VALIDATION:tagIds');
    expect(
      await fieldOf(runAs(prisma, org.coach, (tx) => deleteTag(tx, org.coach, theirs.id))),
    ).toBe('NOT_FOUND:');
    expect(
      await fieldOf(runAs(prisma, w.client, (tx) => createTag(tx, w.client, { name: 'x' }))),
    ).toBe('FORBIDDEN:');
  });
});
