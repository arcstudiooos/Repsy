import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, NOW, runAs } from '../sessions/fixtures.test-helpers';
import {
  calendarFeed,
  esc,
  hasCalendarFeed,
  revokeCalendarToken,
  rotateCalendarToken,
} from './feed';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('calendar feed (PRD L7)', () => {
  it('serves the client’s workouts as all-day events for the current link only', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // workouts 4, 6 and 9 Nov
    const { token } = await runAs(prisma, w.client, (tx) => rotateCalendarToken(tx, w.client));
    expect(await runAs(prisma, w.client, (tx) => hasCalendarFeed(tx, w.client))).toBe(true);
    const ics = await calendarFeed(prisma, token, {
      now: NOW,
      appBaseUrl: 'https://repsy.test',
    });
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics!.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261104');
    expect(ics).toContain('DTEND;VALUE=DATE:20261105');
    expect(ics).toContain('URL:https://repsy.test/portal/workouts/');
    expect(ics!.endsWith('END:VCALENDAR\r\n')).toBe(true);

    // A new link replaces the old one; turning it off ends both.
    const second = await runAs(prisma, w.client, (tx) => rotateCalendarToken(tx, w.client));
    expect(await calendarFeed(prisma, token, { now: NOW })).toBeNull();
    expect(await calendarFeed(prisma, second.token, { now: NOW })).not.toBeNull();
    await runAs(prisma, w.client, (tx) => revokeCalendarToken(tx, w.client));
    expect(await calendarFeed(prisma, second.token, { now: NOW })).toBeNull();
    expect(await calendarFeed(prisma, 'not a token', { now: NOW })).toBeNull();
  });

  it('is the client’s own: a coach can’t make one', async () => {
    const org = await newOrg(prisma);
    await expect(
      runAs(prisma, org.coach, (tx) => rotateCalendarToken(tx, org.coach)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('escapes text values (RFC 5545)', () => {
    expect(esc('Legs; heavy, then core\\done\nnext')).toBe(
      'Legs\\; heavy\\, then core\\\\done\\nnext',
    );
  });
});
