import { createPrivateKey, sign } from 'node:crypto';
import type { SystemTx, TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';

/**
 * PRD H11, D-011 #6: web push through the portal's service worker, with standard VAPID. Off unless both
 * `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set (base64url: the 65-byte uncompressed P-256 public key and the
 * 32-byte private key). Pushes carry no payload at all: the service worker shows a generic notice and the portal shows
 * the rest once opened, as emails never carry content (D-007).
 */
export const PUSH_KINDS = [
  'new_message',
  'workout_reminder',
  'checkin_reminder',
  'habit_reminder',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Subscriptions kept per user (one per device and browser). */
export const PUSH_DEVICES_MAX = 10;

export function vapidKeys(
  env: NodeJS.ProcessEnv = process.env,
): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const contact = env.SUPPORT_EMAIL?.trim() || 'support@kinetic.invalid';
  return { publicKey, privateKey, subject: `mailto:${contact}` };
}

/** Queues a push in the caller's transaction (no-op while push is off). Same key twice: one push. */
export async function enqueuePush(
  tx: TenantTx,
  input: { toUserId: string; kind: PushKind; idempotencyKey: string },
): Promise<boolean> {
  if (!vapidKeys()) return false;
  const { count } = await tx.outboxPush.createMany({
    data: [
      {
        toUserId: input.toUserId,
        kind: input.kind,
        idempotencyKey: `push:${input.idempotencyKey}`,
      },
    ] as never,
    skipDuplicates: true,
  });
  return count === 1;
}

const invalid = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { subscription: [message] });

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Saves this device's subscription for the acting user (an endpoint moves to whoever subscribed it last). */
export async function savePushSubscription(
  tx: TenantTx,
  actor: ActorContext,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  if (!vapidKeys())
    throw new DomainError('CONFLICT', 'Notifications on this device are not available yet.');
  let url: URL;
  try {
    url = new URL(input.endpoint);
  } catch {
    throw invalid('Invalid subscription.');
  }
  if (url.protocol !== 'https:' || input.endpoint.length > 1000)
    throw invalid('Invalid subscription.');
  const { p256dh, auth } = input.keys;
  if (!B64URL.test(p256dh) || p256dh.length > 200 || !B64URL.test(auth) || auth.length > 100) {
    throw invalid('Invalid subscription.');
  }
  // Another user's row for this endpoint (a shared device) is invisible here: `releaseEndpoint` runs first.
  const existing = await tx.pushSubscription.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, endpoint: true },
  });
  if (existing.some((s) => s.endpoint === input.endpoint)) return;
  if (existing.length >= PUSH_DEVICES_MAX) {
    await tx.pushSubscription.delete({ where: { id: existing[0]!.id } });
  }
  await tx.pushSubscription.create({
    data: { userId: actor.userId, endpoint: input.endpoint, p256dh, auth },
  });
}

/**
 * System scope, before `savePushSubscription`: a browser endpoint belongs to whoever subscribed it last, so another
 * user's row for it (a shared device whose earlier user didn't sign out) is removed. Nothing is pushed to them again.
 */
export async function releaseEndpoint(
  tx: SystemTx,
  endpoint: string,
  userId: string,
): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { endpoint, NOT: { userId } } });
}

/** Removes this device's subscription (the acting user's only). */
export async function deletePushSubscription(
  tx: TenantTx,
  actor: ActorContext,
  endpoint: string,
): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { userId: actor.userId, endpoint } });
}

export async function hasPushSubscription(
  tx: TenantTx,
  actor: ActorContext,
  endpoint: string,
): Promise<boolean> {
  return (await tx.pushSubscription.count({ where: { userId: actor.userId, endpoint } })) > 0;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** The VAPID `Authorization` header for one push service (RFC 8292), signed ES256. */
export function vapidAuthorization(
  endpoint: string,
  keys: { publicKey: string; privateKey: string; subject: string },
  now: Date = new Date(),
): string {
  const pub = Buffer.from(keys.publicKey, 'base64url');
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 key');
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** Push services answer 404/410 for a subscription that is gone for good. */
const GONE = new Set([404, 410]);

/**
 * Worker (PRD H11): sends queued pushes to every device of their recipient, at most `limit` per run. A device the push
 * service reports gone is forgotten; a push with no devices is marked sent (nothing to deliver). A network or server
 * failure leaves the push queued for the next run, up to 5 attempts.
 */
export async function deliverPushes(
  withSystem: <T>(fn: (tx: SystemTx) => Promise<T>) => Promise<T>,
  send: (endpoint: string, headers: Record<string, string>) => Promise<number>,
  opts: { now?: Date; limit?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ sent: number; dropped: number }> {
  const keys = vapidKeys(opts.env);
  if (!keys) return { sent: 0, dropped: 0 };
  const now = opts.now ?? new Date();
  const queued = await withSystem((tx) =>
    tx.outboxPush.findMany({
      where: { sentAt: null, attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: opts.limit ?? 200,
      select: { id: true, toUserId: true, kind: true },
    }),
  );
  let sent = 0;
  let dropped = 0;
  for (const p of queued) {
    const devices = await withSystem((tx) =>
      tx.pushSubscription.findMany({
        where: { userId: p.toUserId },
        select: { id: true, endpoint: true },
      }),
    );
    let failed = false;
    for (const d of devices) {
      let status: number;
      try {
        status = await send(d.endpoint, {
          Authorization: vapidAuthorization(d.endpoint, keys, now),
          TTL: '86400',
          Urgency: p.kind === 'new_message' ? 'high' : 'normal',
          Topic: p.kind.replace(/_/g, ''),
          'Content-Length': '0',
        });
      } catch {
        failed = true;
        continue;
      }
      if (GONE.has(status)) {
        await withSystem((tx) => tx.pushSubscription.deleteMany({ where: { id: d.id } }));
        dropped += 1;
      } else if (status >= 200 && status < 300) {
        await withSystem((tx) =>
          tx.pushSubscription.updateMany({ where: { id: d.id }, data: { lastSentAt: now } }),
        );
        sent += 1;
      } else if (status === 429 || status >= 500) {
        failed = true;
      }
    }
    await withSystem((tx) =>
      tx.outboxPush.update({
        where: { id: p.id },
        data: failed ? { attempts: { increment: 1 } } : { sentAt: now },
      }),
    );
  }
  // Delivered pushes are kept a week, then dropped.
  await withSystem((tx) =>
    tx.outboxPush.deleteMany({
      where: { sentAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
    }),
  );
  return { sent, dropped };
}
