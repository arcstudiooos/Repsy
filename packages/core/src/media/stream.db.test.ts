import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import { mediaPlayback, processVideoStreams, type StreamConfig } from './stream';

/** PRD L11: demo videos go to Cloudflare Stream (faked at fetch) and play as HLS once ready. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let org: ClientWorld;
const config: StreamConfig = { accountId: 'acct', apiToken: 'tok' };
const storage = { read: async () => Buffer.from('mp4-bytes') };

function fakeStream(state: { ready: boolean }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.replace(/^.*\/stream/, '/stream')}`);
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (method === 'POST') return ok({ uid: 'vid1' });
    if (method === 'DELETE') return ok(null);
    return ok(
      state.ready
        ? {
            uid: 'vid1',
            readyToStream: true,
            playback: { hls: 'https://cf.test/vid1/manifest/video.m3u8' },
          }
        : { uid: 'vid1', readyToStream: false, status: { state: 'inprogress' } },
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

let demoId: string;
let formCheckId: string;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  org = await newClientWorld(prisma, await newOrg(prisma));
  const make = (purpose: string, key: string, clientId: string | null = null) =>
    withSystem(
      (tx) =>
        tx.mediaFile.create({
          data: {
            organizationId: org.orgId,
            uploadedBy: org.coach.userId,
            clientId,
            purpose,
            contentType: 'video/mp4',
            bytes: 9,
            storageKey: key,
          },
        }),
      prisma,
    );
  demoId = (await make('exercise_demo', 'k-demo')).id;
  formCheckId = (await make('form_check', 'k-form', org.clientId)).id;
});
afterAll(async () => {
  await drop();
});

describe('adaptive video', () => {
  it('sends only coach demos, then switches playback to HLS when ready', async () => {
    const state = { ready: false };
    const s = fakeStream(state);
    expect(
      await processVideoStreams(prisma, storage, config, { fetchImpl: s.fetchImpl }),
    ).toMatchObject({
      sent: 1,
    });
    expect(s.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
    const form = await withSystem(
      (tx) => tx.mediaFile.findUniqueOrThrow({ where: { id: formCheckId } }),
      prisma,
    );
    expect(form.streamStatus).toBeNull();

    let play = await runAs(prisma, org.coach, (tx) => mediaPlayback(tx, org.coach, demoId));
    expect(play).toEqual({ hls: null, mp4: `/api/v1/media/${demoId}`, processing: true });

    state.ready = true;
    expect(
      await processVideoStreams(prisma, storage, config, { fetchImpl: s.fetchImpl }),
    ).toMatchObject({
      ready: 1,
    });
    play = await runAs(prisma, org.coach, (tx) => mediaPlayback(tx, org.coach, demoId));
    expect(play.hls).toBe('https://cf.test/vid1/manifest/video.m3u8');
  });

  it('deletes the Stream copy when the file is erased', async () => {
    await withSystem(
      (tx) => tx.mediaFile.update({ where: { id: demoId }, data: { erasedAt: new Date() } }),
      prisma,
    );
    const s = fakeStream({ ready: true });
    expect(
      await processVideoStreams(prisma, storage, config, { fetchImpl: s.fetchImpl }),
    ).toMatchObject({
      removed: 1,
    });
    expect(s.calls).toContain('DELETE /stream/vid1');
  });
});
