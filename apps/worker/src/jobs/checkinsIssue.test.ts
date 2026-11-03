import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { issueCheckins } from './checkinsIssue';
import { renderTemplate } from './templates';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let seq = 0;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** An organization with one active, linked client whose check-in weekday is `weekday`. */
async function orgWithClient(timezone: string, weekday: number | null): Promise<string> {
  seq += 1;
  return withSystem(async (tx) => {
    const coach = await tx.user.create({ data: { email: `co${seq}@example.test`, name: 'Coach' } });
    const user = await tx.user.create({ data: { email: `cl${seq}@example.test`, name: 'Client' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone, ownerUserId: coach.id },
    });
    await tx.membership.create({
      data: { userId: coach.id, organizationId: org.id, role: 'owner' },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: org.id, role: 'client' },
    });
    const client = await tx.client.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        coachUserId: coach.id,
        name: 'Client',
        email: user.email,
        status: 'active',
        timezone,
        checkinWeekday: weekday,
      },
    });
    return client.id;
  }, prisma);
}

const checkins = (clientId: string) =>
  withSystem((tx) => tx.checkin.count({ where: { clientId } }), prisma);

describe('issueCheckins', () => {
  it('issues each due check-in once across organizations and zones (run x2)', async () => {
    // Wednesday 2026-11-04 07:00 UTC: 07:00 in London (issue), 02:00 in New York (not yet).
    const now = new Date('2026-11-04T07:00:00Z');
    const london = await orgWithClient('Europe/London', 3);
    const newYork = await orgWithClient('America/New_York', 3);
    const thursday = await orgWithClient('Europe/London', 4);
    const none = await orgWithClient('Europe/London', null);

    expect((await issueCheckins(prisma, now)).issued).toBe(1);
    expect((await issueCheckins(prisma, now)).issued).toBe(0);
    expect([
      await checkins(london),
      await checkins(newYork),
      await checkins(thursday),
      await checkins(none),
    ]).toEqual([1, 0, 0, 0]);

    // 06:00 in New York.
    expect((await issueCheckins(prisma, new Date('2026-11-04T11:00:00Z'))).issued).toBe(1);
    expect(await checkins(newYork)).toBe(1);
  });

  it('renders the check-in ready email with a link and no answers', () => {
    const r = renderTemplate(
      'checkin_ready',
      { coachName: 'Sam', checkinId: 'abc' },
      'https://app.test/',
    );
    expect(r.subject).toBe('Your weekly check-in is ready');
    expect(r.text).toContain('https://app.test/portal/check-ins/abc');
    expect(r.text).toContain('Sam');
  });

  it('renders the new-message email without the body', () => {
    const r = renderTemplate(
      'new_message',
      { senderName: 'Ana', toPortal: true },
      'https://app.test',
    );
    expect(r.subject).toBe('New message from Ana');
    expect(r.text).toBe(
      'You have a new message from Ana.\n\nRead it in Repsy: https://app.test/portal/messages',
    );
  });
});
