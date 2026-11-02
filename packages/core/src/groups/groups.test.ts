import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  commentOnPost,
  dismissGroupReport,
  displayName,
  getGroup,
  listGroups,
  moderateGroupItem,
  muteMember,
  postToGroup,
  reactToPost,
  reportGroupItem,
  saveGroup,
  setGroupMembers,
} from './groups';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('groups (PRD H7, H8)', () => {
  it('shows members by first name and initial', () => {
    expect(displayName('Ana Maria Silva')).toBe('Ana S.');
    expect(displayName('Cher')).toBe('Cher');
  });

  it('lets members chat, post, comment, react, report and mute; coaches moderate', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const outsider = await newClientWorld(prisma, org);
    const { id } = await runAs(prisma, org.coach, (tx) =>
      saveGroup(tx, org.coach, { name: 'Spring cohort', description: '12 weeks together' }),
    );
    await runAs(prisma, org.coach, (tx) =>
      setGroupMembers(tx, org.coach, id, [a.clientId, b.clientId]),
    );
    expect(await runAs(prisma, a.client, (tx) => listGroups(tx, a.client))).toMatchObject([
      { name: 'Spring cohort', members: 2 },
    ]);
    expect(await runAs(prisma, outsider.client, (tx) => listGroups(tx, outsider.client))).toEqual(
      [],
    );
    await expect(
      runAs(prisma, outsider.client, (tx) => getGroup(tx, outsider.client, id, 'chat')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await runAs(prisma, a.client, (tx) =>
      postToGroup(
        tx,
        a.client,
        id,
        { kind: 'chat', body: 'Morning all!' },
        { now: new Date('2026-11-01T08:00:00Z') },
      ),
    );
    await runAs(prisma, org.coach, (tx) =>
      postToGroup(
        tx,
        org.coach,
        id,
        { kind: 'chat', body: 'Welcome!' },
        { now: new Date('2026-11-01T09:00:00Z') },
      ),
    );
    const chat = await runAs(prisma, b.client, (tx) => getGroup(tx, b.client, id, 'chat'));
    expect(chat.items.map((i) => [i.author, i.body, i.byCoach])).toEqual([
      ['Client', 'Morning all!', false],
      ['Coach', 'Welcome!', true],
    ]);

    const post = await runAs(prisma, a.client, (tx) =>
      postToGroup(tx, a.client, id, { kind: 'post', body: 'Hit a 100 kg squat today' }),
    );
    await runAs(prisma, b.client, (tx) => commentOnPost(tx, b.client, post.id, { body: 'Huge!' }));
    await runAs(prisma, b.client, (tx) =>
      reactToPost(tx, b.client, post.id, { kind: 'strong', on: true }),
    );
    await runAs(prisma, b.client, (tx) =>
      reactToPost(tx, b.client, post.id, { kind: 'strong', on: true }),
    );
    let feed = await runAs(prisma, a.client, (tx) => getGroup(tx, a.client, id, 'post'));
    expect(feed.items[0]).toMatchObject({ mine: true, comments: [{ body: 'Huge!' }] });
    expect(feed.items[0]!.reactions.find((r) => r.kind === 'strong')).toEqual({
      kind: 'strong',
      count: 1,
      mine: false,
    });
    // Comments belong on feed posts only.
    await expect(
      runAs(prisma, b.client, (tx) =>
        commentOnPost(tx, b.client, chat.items[0]!.id, { body: 'x' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Mute: A no longer sees B's comment. Coaches can't be muted.
    await runAs(prisma, a.client, (tx) => muteMember(tx, a.client, b.userId, true));
    feed = await runAs(prisma, a.client, (tx) => getGroup(tx, a.client, id, 'post'));
    expect(feed.items[0]!.comments).toEqual([]);
    expect(feed.muted).toEqual([b.userId]);
    await expect(
      runAs(prisma, a.client, (tx) => muteMember(tx, a.client, org.coach.userId, true)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Report, then the coach hides the post: the report is settled and members no longer see it.
    await runAs(prisma, b.client, (tx) =>
      reportGroupItem(tx, b.client, { postId: post.id, reason: 'Off topic' }),
    );
    await runAs(prisma, b.client, (tx) => reportGroupItem(tx, b.client, { postId: post.id }));
    let coachView = await runAs(prisma, org.coach, (tx) => getGroup(tx, org.coach, id, 'post'));
    expect(coachView.reports).toMatchObject([
      { what: 'post', reason: 'Off topic', author: 'Client' },
    ]);
    expect(await runAs(prisma, org.coach, (tx) => listGroups(tx, org.coach))).toMatchObject([
      { openReports: 1 },
    ]);
    await expect(
      runAs(prisma, a.client, (tx) => moderateGroupItem(tx, a.client, { postId: post.id })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runAs(prisma, org.coach, (tx) => moderateGroupItem(tx, org.coach, { postId: post.id }));
    coachView = await runAs(prisma, org.coach, (tx) => getGroup(tx, org.coach, id, 'post'));
    expect(coachView.reports).toEqual([]);
    expect(coachView.items[0]).toMatchObject({ hidden: true });
    expect(
      (await runAs(prisma, b.client, (tx) => getGroup(tx, b.client, id, 'post'))).items,
    ).toEqual([]);

    // A report the coach dismisses.
    const other = await runAs(prisma, b.client, (tx) =>
      postToGroup(tx, b.client, id, { kind: 'post', body: 'Anyone running Sunday?' }),
    );
    await runAs(prisma, a.client, (tx) => reportGroupItem(tx, a.client, { postId: other.id }));
    const [report] = (await runAs(prisma, org.coach, (tx) => getGroup(tx, org.coach, id, 'post')))
      .reports;
    await runAs(prisma, org.coach, (tx) => dismissGroupReport(tx, org.coach, report!.id));
    expect(
      (await runAs(prisma, org.coach, (tx) => getGroup(tx, org.coach, id, 'post'))).reports,
    ).toEqual([]);

    // Removed from the group: no access.
    await runAs(prisma, org.coach, (tx) => setGroupMembers(tx, org.coach, id, [a.clientId]));
    await expect(
      runAs(prisma, b.client, (tx) => getGroup(tx, b.client, id, 'post')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
