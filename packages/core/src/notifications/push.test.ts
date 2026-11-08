import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getClientThread, sendMessage } from '../messages/messages';
import {
  deletePushSubscription,
  deliverPushes,
  enqueuePush,
  hasPushSubscription,
  isPushServiceEndpoint,
  releaseEndpoint,
  savePushSubscription,
  vapidAuthorization,
} from './push';

let prisma: PrismaClient;
let drop: () => Promise<void>;
const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };

function vapid() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const raw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  const d = (privateKey.export({ format: 'jwk' }) as { d: string }).d;
  return { publicKey: raw.toString('base64url'), privateKey: d, verifier: publicKey };
}
const keys = vapid();

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
});
afterAll(async () => {
  process.env.VAPID_PUBLIC_KEY = saved.pub;
  process.env.VAPID_PRIVATE_KEY = saved.priv;
  if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  await drop();
});

const sub = (n: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  keys: { p256dh: 'BKey_abc', auth: 'auth_1' },
});

describe('web push (PRD H11)', () => {
  it('signs a VAPID header the push service can verify', () => {
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/x', {
      ...keys,
      subject: 'mailto:help@example.test',
    });
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString()) as { aud: string };
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    const ok = verify(
      'sha256',
      Buffer.from(`${m[1]}.${m[2]}`),
      {
        key: createPublicKey(keys.verifier.export({ format: 'pem', type: 'spki' })),
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(m[3]!, 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('a message queues a push; delivery reaches the device and forgets one that is gone', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, w.client, (tx) => savePushSubscription(tx, w.client, sub('a')));
    await runAs(prisma, w.client, (tx) => savePushSubscription(tx, w.client, sub('gone')));
    expect(
      await runAs(prisma, w.client, (tx) => hasPushSubscription(tx, w.client, sub('a').endpoint)),
    ).toBe(true);
    // The coach can't see the client's devices.
    expect(await runAs(prisma, org.coach, (tx) => tx.pushSubscription.count())).toBe(0);

    const thread = await runAs(prisma, org.coach, (tx) =>
      getClientThread(tx, org.coach, w.clientId),
    );
    await runAs(prisma, org.coach, (tx) =>
      sendMessage(tx, org.coach, thread.id, {
        body: 'Nice work',
        clientMessageId: crypto.randomUUID(),
      }),
    );
    const calls: { endpoint: string; headers: Record<string, string> }[] = [];
    const res = await deliverPushes(
      (fn) => withSystem(fn, prisma),
      async (endpoint, headers) => {
        calls.push({ endpoint, headers });
        return endpoint.endsWith('/gone') ? 410 : 201;
      },
    );
    expect(res).toEqual({ sent: 1, dropped: 1 });
    expect(calls.every((c) => c.headers['Content-Length'] === '0')).toBe(true);
    expect(calls[0]!.headers.Authorization).toMatch(/^vapid t=/);
    // Sent once only.
    expect(
      await deliverPushes(
        (fn) => withSystem(fn, prisma),
        async () => 201,
      ),
    ).toEqual({
      sent: 0,
      dropped: 0,
    });
    const left = await withSystem((tx) => tx.pushSubscription.findMany(), prisma);
    expect(left.map((s) => s.endpoint)).toEqual([sub('a').endpoint]);
  });

  it('a shared device moves to whoever subscribed it last; unsubscribing removes it', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const s = sub('shared');
    await runAs(prisma, a.client, (tx) => savePushSubscription(tx, a.client, s));
    await withSystem((tx) => releaseEndpoint(tx, s.endpoint, b.client.userId), prisma);
    await runAs(prisma, b.client, (tx) => savePushSubscription(tx, b.client, s));
    const rows = await withSystem(
      (tx) => tx.pushSubscription.findMany({ where: { endpoint: s.endpoint } }),
      prisma,
    );
    expect(rows.map((r) => r.userId)).toEqual([b.client.userId]);
    await runAs(prisma, b.client, (tx) => deletePushSubscription(tx, b.client, s.endpoint));
    expect(
      await withSystem(
        (tx) => tx.pushSubscription.count({ where: { endpoint: s.endpoint } }),
        prisma,
      ),
    ).toBe(0);
  });

  it('queues nothing while push is off', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      const made = await runAs(prisma, org.coach, (tx) =>
        enqueuePush(tx, { toUserId: w.client.userId, kind: 'new_message', idempotencyKey: 'x' }),
      );
      expect(made).toBe(false);
    } finally {
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    }
  });

  it('accepts only https endpoints on a known push service (no SSRF through the worker)', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://api.push.apple.com/3/device/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushServiceEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pw@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com.example/x',
      'https://169.254.169.254/latest/meta-data',
      'https://internal-service.local/admin',
      'https://localhost/x',
      'not a url',
      `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
    ]) {
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
    }
  });

  it('refuses to save a non-push-service endpoint', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, w.client, (tx) =>
        savePushSubscription(tx, w.client, {
          endpoint: 'https://internal-service.local/admin',
          keys: { p256dh: 'BKey_abc', auth: 'auth_1' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('never sends to a stored endpoint outside the allowlist, and forgets it', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    // A row from before the allowlist, written straight to the table.
    await withSystem(
      (tx) =>
        tx.pushSubscription.create({
          data: {
            userId: w.client.userId,
            endpoint: 'https://internal-service.local/hook',
            p256dh: 'BKey_abc',
            auth: 'auth_1',
          },
        }),
      prisma,
    );
    await runAs(prisma, org.coach, (tx) =>
      enqueuePush(tx, {
        toUserId: w.client.userId,
        kind: 'new_message',
        idempotencyKey: `legacy-${w.clientId}`,
      }),
    );
    const calls: string[] = [];
    const res = await deliverPushes(
      (fn) => withSystem(fn, prisma),
      async (endpoint) => {
        calls.push(endpoint);
        return 201;
      },
    );
    expect(calls).not.toContain('https://internal-service.local/hook');
    expect(res.dropped).toBeGreaterThanOrEqual(1);
    const left = await withSystem(
      (tx) => tx.pushSubscription.count({ where: { userId: w.client.userId } }),
      prisma,
    );
    expect(left).toBe(0);
  });
});
