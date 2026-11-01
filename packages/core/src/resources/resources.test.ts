import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createTag, deleteTag, setClientTags } from '../clients/tags';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { archiveResource, createResource, listResources } from './resources';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('resource library (PRD G5)', () => {
  it('shares with all, a tag or one client; clients see only theirs; archive and tag delete remove', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const tag = await runAs(prisma, org.coach, (tx) =>
      createTag(tx, org.coach, { name: 'Runners' }),
    );
    await runAs(prisma, org.coach, (tx) => setClientTags(tx, org.coach, a.clientId, [tag.id]));
    const add = (input: Parameters<typeof createResource>[2]) =>
      runAs(prisma, org.coach, (tx) => createResource(tx, org.coach, input));
    const all = await add({
      title: 'Warm-up guide',
      url: 'https://example.com/warmup',
      audience: 'all',
    });
    expect(all).toMatchObject({ sharedWith: 'All clients' });
    const runners = await add({
      title: 'Running drills',
      body: 'A skips, B skips, strides.',
      audience: 'tag',
      tagId: tag.id,
    });
    expect(runners.sharedWith).toBe('Tag: Runners');
    await add({
      title: 'Your mobility plan',
      body: 'Hips first.',
      audience: 'client',
      clientId: b.clientId,
    });

    const seenBy = async (w: typeof a) =>
      (await runAs(prisma, w.client, (tx) => listResources(tx, w.client)))
        .map((r) => r.title)
        .sort();
    expect(await seenBy(a)).toEqual(['Running drills', 'Warm-up guide']);
    expect(await seenBy(b)).toEqual(['Warm-up guide', 'Your mobility plan']);
    expect(
      (await runAs(prisma, a.client, (tx) => listResources(tx, a.client)))[0]!.sharedWith,
    ).toBeNull();

    const field = (input: Parameters<typeof createResource>[2]) =>
      add(input).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(await field({ title: 'X', url: 'http://insecure.example', audience: 'all' })).toBe(
      'url',
    );
    expect(await field({ title: 'X', url: 'javascript:alert(1)', audience: 'all' })).toBe('url');
    expect(await field({ title: 'X', audience: 'all' })).toBe('url');
    expect(await field({ title: '', body: 'x', audience: 'all' })).toBe('title');
    expect(await field({ title: 'X', body: 'x', audience: 'everyone' })).toBe('audience');
    await expect(
      runAs(prisma, a.client, (tx) =>
        createResource(tx, a.client, { title: 'X', body: 'x', audience: 'all' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await runAs(prisma, org.coach, (tx) => archiveResource(tx, org.coach, all.id));
    expect(await seenBy(b)).toEqual(['Your mobility plan']);
    await runAs(prisma, org.coach, (tx) => deleteTag(tx, org.coach, tag.id));
    expect(await seenBy(a)).toEqual([]);
  });
});
