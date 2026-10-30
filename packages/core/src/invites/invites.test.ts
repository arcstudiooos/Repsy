import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findInviteByTokenHash, withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { createClient } from '../clients/clients';
import { DomainError } from '../errors';
import { acceptInvite, classifyInvite, INVITE_TTL_MS, issueInvite, revokeInvite } from './invites';
import { PRIVACY_NOTICE_VERSION } from '../privacy';
import { newInviteToken } from './token';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;
let seq = 0;

const T0 = new Date('2026-03-01T10:00:00.000Z');
const sha = (token: string) => createHash('sha256').update(token).digest('hex');

const actorFor = (orgId: string): ActorContext => ({
  userId: coachId,
  orgId,
  role: 'owner',
  isPlatformAdmin: false,
});

const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : 'other'),
  );

async function setup() {
  seq += 1;
  const org = await withSystem(
    (tx) =>
      tx.organization.create({ data: { name: 'Gym', timezone: 'UTC', ownerUserId: coachId } }),
    prisma,
  );
  const actor = actorFor(org.id);
  const client = await run(actor, (tx) =>
    createClient(tx, actor, { name: 'Ann', email: `ann${seq}@example.test` }),
  );
  const clientUser = await withSystem(
    (tx) => tx.user.create({ data: { email: `cu${seq}@example.test`, name: 'Ann' } }),
    prisma,
  );
  return { actor, client, orgId: org.id, clientUserId: clientUser.id };
}

/** Issues an invite and recovers the plaintext token from the outbox payload. */
async function issue(actor: ActorContext, clientId: string, now = T0) {
  const res = await run(actor, (tx) => issueInvite(tx, actor, clientId, now));
  const mail = await withSystem(
    (tx) =>
      tx.outboxEmail.findUniqueOrThrow({
        where: { idempotencyKey: `client_invite:${res.inviteId}` },
      }),
    prisma,
  );
  const token = (mail.payloadJson as { token: string }).token;
  return { ...res, token, tokenHash: sha(token), mail };
}

const accept = (tokenHash: string, userId: string, now = T0) =>
  acceptInvite(
    {
      tokenHash,
      userId,
      consentVersion: PRIVACY_NOTICE_VERSION,
      timezone: 'Europe/Paris',
      preferredUnits: 'lb',
      goals: 'Lift',
    },
    now,
    prisma,
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  coachId = (
    await withSystem(
      (tx) => tx.user.create({ data: { email: 'coach@example.test', name: 'Coach Carl' } }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('invite tokens', () => {
  it('token is 43 base64url chars and only the hash is stored', async () => {
    const generated = newInviteToken();
    expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generated.tokenHash).toBe(sha(generated.token));
    expect(generated.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const { actor, client } = await setup();
    const issued = await issue(actor, client.id);
    const rows = await withSystem(
      (tx) => tx.clientInvite.findMany({ where: { clientId: client.id } }),
      prisma,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(issued.tokenHash);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(issued.mail.payloadJson).toMatchObject({ coachName: 'Coach Carl', orgName: 'Gym' });
    expect(issued.mail).toMatchObject({ toUserId: null, toEmail: expect.stringContaining('@') });
  });
});

describe('invites', () => {
  it('resend revokes the previous invite', async () => {
    const { actor, client } = await setup();
    const first = await issue(actor, client.id);
    const second = await issue(actor, client.id, new Date(T0.getTime() + 1000));
    expect(classifyInvite(await findInviteByTokenHash(first.tokenHash, prisma), T0)).toBe(
      'INVITE_REVOKED',
    );
    expect(classifyInvite(await findInviteByTokenHash(second.tokenHash, prisma), T0)).toBe('ok');
    await expect(code(accept(first.tokenHash, 'x'))).resolves.toBe('INVITE_REVOKED');
  });

  it('expires after 7 days', async () => {
    const { actor, client } = await setup();
    const { tokenHash, expiresAt } = await issue(actor, client.id);
    expect(INVITE_TTL_MS).toBe(7 * 86_400_000);
    expect(expiresAt).toEqual(new Date(T0.getTime() + INVITE_TTL_MS));
    const found = await findInviteByTokenHash(tokenHash, prisma);
    expect(classifyInvite(found, new Date(expiresAt.getTime() - 1))).toBe('ok');
    expect(classifyInvite(found, expiresAt)).toBe('INVITE_EXPIRED');
    expect(classifyInvite(null, T0)).toBe('INVITE_INVALID');
  });

  it('concurrent accept links once', async () => {
    const { actor, client, orgId, clientUserId } = await setup();
    const { tokenHash } = await issue(actor, client.id);
    const results = await Promise.allSettled([
      accept(tokenHash, clientUserId),
      accept(tokenHash, clientUserId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.reason).toMatchObject({ code: 'INVITE_USED' });
    const memberships = await withSystem(
      (tx) => tx.membership.findMany({ where: { userId: clientUserId, organizationId: orgId } }),
      prisma,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: 'client', status: 'active' });
    const row = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: client.id } }),
      prisma,
    );
    expect(row).toMatchObject({
      userId: clientUserId,
      status: 'active',
      consentVersion: PRIVACY_NOTICE_VERSION,
      timezone: 'Europe/Paris',
      preferredUnits: 'lb',
      goals: 'Lift',
    });
    expect(row.consentAt).toEqual(T0);
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: client.id, action: 'invite.accepted' } }),
      prisma,
    );
    expect(audits).toHaveLength(1);
  });

  it('issuing for an active client → CONFLICT', async () => {
    const { actor, client } = await setup();
    await withSystem(
      (tx) => tx.client.update({ where: { id: client.id }, data: { status: 'active' } }),
      prisma,
    );
    await expect(code(run(actor, (tx) => issueInvite(tx, actor, client.id, T0)))).resolves.toBe(
      'CONFLICT',
    );
  });

  it('email enqueued once per invite id', async () => {
    const { actor, client } = await setup();
    const a = await issue(actor, client.id);
    const b = await issue(actor, client.id);
    expect(a.inviteId).not.toBe(b.inviteId);
    const mails = await withSystem(
      (tx) =>
        tx.outboxEmail.findMany({
          where: { idempotencyKey: { startsWith: 'client_invite:' }, organizationId: actor.orgId },
        }),
      prisma,
    );
    expect(mails.map((m) => m.idempotencyKey).sort()).toEqual(
      [`client_invite:${a.inviteId}`, `client_invite:${b.inviteId}`].sort(),
    );
  });

  it('revokeInvite revokes open invites and audits', async () => {
    const { actor, client } = await setup();
    const { tokenHash } = await issue(actor, client.id);
    await run(actor, (tx) => revokeInvite(tx, actor, client.id));
    expect(classifyInvite(await findInviteByTokenHash(tokenHash, prisma), T0)).toBe(
      'INVITE_REVOKED',
    );
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: client.id, action: 'invite.revoked' } }),
      prisma,
    );
    expect(audits).toHaveLength(1);
  });

  it('accepting expired or unknown invites throws', async () => {
    const { actor, client, clientUserId } = await setup();
    const { tokenHash, expiresAt } = await issue(actor, client.id);
    await expect(code(accept(tokenHash, clientUserId, expiresAt))).resolves.toBe('INVITE_EXPIRED');
    await expect(code(accept('0'.repeat(64), clientUserId))).resolves.toBe('INVITE_INVALID');
  });
});

describe('accept vs resend concurrency', () => {
  it('never deadlocks and ends consistent', async () => {
    const org = await withSystem(
      (tx) =>
        tx.organization.create({ data: { name: 'Race', timezone: 'UTC', ownerUserId: coachId } }),
      prisma,
    );
    const actor = actorFor(org.id);
    const allowed = new Set(['INVITE_REVOKED', 'INVITE_USED', 'CONFLICT']);
    for (let i = 0; i < 20; i++) {
      const client = await run(actor, (tx) =>
        createClient(tx, actor, { name: 'R', email: `race${i}@example.test` }),
      );
      const user = await withSystem(
        (tx) => tx.user.create({ data: { email: `racer${i}@example.test`, name: 'R' } }),
        prisma,
      );
      const first = await issue(actor, client.id);
      const results = await Promise.allSettled([
        ...[0, 1, 2].map(() => run(actor, (tx) => issueInvite(tx, actor, client.id, T0))),
        ...[0, 1, 2].map(() => accept(first.tokenHash, user.id)),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason, String(r.reason)).toBeInstanceOf(DomainError);
          expect(allowed.has((r.reason as DomainError).code)).toBe(true);
        }
      }
      const invites = await withSystem(
        (tx) => tx.clientInvite.findMany({ where: { clientId: client.id } }),
        prisma,
      );
      expect(invites.filter((x) => !x.acceptedAt && !x.revokedAt).length).toBeLessThanOrEqual(1);
      const row = await withSystem(
        (tx) => tx.client.findUniqueOrThrow({ where: { id: client.id } }),
        prisma,
      );
      if (invites.some((x) => x.acceptedAt)) {
        expect(row).toMatchObject({ status: 'active', userId: user.id });
      } else {
        expect(row).toMatchObject({ status: 'invited', userId: null });
      }
    }
  }, 60_000);
});

describe('acceptInvite input validation', () => {
  const base = {
    consentVersion: PRIVACY_NOTICE_VERSION,
    timezone: 'Europe/Paris',
    preferredUnits: 'kg' as const,
  };
  const attempt = async (patch: Record<string, unknown>) => {
    const { actor, client, clientUserId } = await setup();
    const { tokenHash } = await issue(actor, client.id);
    const err = await acceptInvite(
      { tokenHash, userId: clientUserId, ...base, ...patch } as Parameters<typeof acceptInvite>[0],
      T0,
      prisma,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    const row = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: client.id } }),
      prisma,
    );
    return { err, row };
  };

  it.each([
    ['goals over 2000 chars', { goals: 'x'.repeat(2001) }, 'goals'],
    ['invalid timezone', { timezone: 'Mars/Olympus' }, 'timezone'],
    ['offset timezone (not IANA)', { timezone: '+05:30' }, 'timezone'],
    ['invalid units', { preferredUnits: 'stone' }, 'preferredUnits'],
    ['wrong consent version', { consentVersion: 'old' }, 'consentVersion'],
  ])('%s -> VALIDATION, nothing written', async (_name, patch, field) => {
    const { err, row } = await attempt(patch);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('VALIDATION');
    expect(Object.keys((err as DomainError).fieldErrors ?? {})).toContain(field);
    expect(row).toMatchObject({ status: 'invited', userId: null });
  });

  it('trims goals; blank goals leave the coach-entered goals alone', async () => {
    const ok = await attempt({ goals: '  Get strong  ' });
    expect(ok.err).toBeNull();
    expect(ok.row.goals).toBe('Get strong');
    const blank = await attempt({ goals: '   ' });
    expect(blank.err).toBeNull();
    expect(blank.row.goals).toBeNull();
  });

  it('a user already linked to another client in the org -> CONFLICT, invite stays open', async () => {
    const { actor, client, clientUserId } = await setup();
    const other = await run(actor, (tx) =>
      createClient(tx, actor, { name: 'Bea', email: `bea${seq}@example.test` }),
    );
    const a = await issue(actor, client.id);
    const b = await issue(actor, other.id);
    await acceptInvite({ tokenHash: a.tokenHash, userId: clientUserId, ...base }, T0, prisma);
    const err = await acceptInvite(
      { tokenHash: b.tokenHash, userId: clientUserId, ...base },
      T0,
      prisma,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('CONFLICT');
    expect((err as DomainError).message).toBe('You are already a client of this coach.');
    const invite = await withSystem(
      (tx) => tx.clientInvite.findFirstOrThrow({ where: { clientId: other.id } }),
      prisma,
    );
    expect(invite.acceptedAt).toBeNull();
  });
});
