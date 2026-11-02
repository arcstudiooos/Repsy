import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  convertLead,
  getPublicProfile,
  listLeads,
  submitLead,
  updateLead,
  updatePublicPage,
} from './leads';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-04T12:00:00Z');
const human = { loadedAt: NOW.getTime() - 20_000 };

describe('public page and leads (PRD B15, B16)', () => {
  it('serves the page only when on, files applications, and turns a lead into an invited client', async () => {
    const org = await newOrg(prisma);
    const slug = `coach-${Date.now().toString(36)}`;
    await runAs(prisma, org.coach, (tx) =>
      updatePublicPage(tx, org.coach, { slug, bio: 'Strength coach', enabled: false }),
    );
    expect(await getPublicProfile(prisma, slug)).toBeNull();
    await runAs(prisma, org.coach, (tx) =>
      updatePublicPage(tx, org.coach, {
        slug,
        bio: 'Strength coach',
        offers: '1:1 online',
        enabled: true,
      }),
    );
    expect(await getPublicProfile(prisma, slug)).toMatchObject({
      bio: 'Strength coach',
      offers: '1:1 online',
    });

    // Bots: a honeypot or a too-fast form is accepted but not stored.
    await submitLead(
      prisma,
      slug,
      { name: 'Bot', email: 'b@example.test', website: 'spam', ...human },
      NOW,
    );
    await submitLead(
      prisma,
      slug,
      { name: 'Fast', email: 'f@example.test', loadedAt: NOW.getTime() - 500 },
      NOW,
    );
    await submitLead(
      prisma,
      slug,
      { name: 'Lia Lead', email: 'LIA@example.test', message: 'Run a marathon', ...human },
      NOW,
    );
    const leads = await runAs(prisma, org.coach, (tx) => listLeads(tx, org.coach));
    expect(leads.map((l) => [l.name, l.email, l.status])).toEqual([
      ['Lia Lead', 'lia@example.test', 'new'],
    ]);
    const mail = await withSystem(
      (tx) => tx.outboxEmail.count({ where: { kind: 'new_lead' } }),
      prisma,
    );
    expect(mail).toBe(1);

    await runAs(prisma, org.coach, (tx) =>
      updateLead(tx, org.coach, leads[0]!.id, { status: 'call_booked', notes: 'Call Thu' }),
    );
    const { clientId } = await runAs(prisma, org.coach, (tx) =>
      convertLead(tx, org.coach, leads[0]!.id, { now: NOW }),
    );
    const client = await withSystem(
      (tx) => tx.client.findFirstOrThrow({ where: { id: clientId } }),
      prisma,
    );
    expect(client).toMatchObject({ name: 'Lia Lead', goals: 'Run a marathon', status: 'invited' });
    expect((await runAs(prisma, org.coach, (tx) => listLeads(tx, org.coach)))[0]!.status).toBe(
      'won',
    );
    await expect(
      runAs(prisma, org.coach, (tx) => convertLead(tx, org.coach, leads[0]!.id)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps addresses unique and well formed', async () => {
    const a = await newOrg(prisma);
    const b = await newOrg(prisma);
    const slug = `taken-${Date.now().toString(36)}`;
    await runAs(prisma, a.coach, (tx) => updatePublicPage(tx, a.coach, { slug, enabled: true }));
    await expect(
      runAs(prisma, b.coach, (tx) => updatePublicPage(tx, b.coach, { slug, enabled: true })),
    ).rejects.toMatchObject({ fieldErrors: { slug: ['That address is taken.'] } });
    await expect(
      runAs(prisma, b.coach, (tx) =>
        updatePublicPage(tx, b.coach, { slug: 'Bad Slug!', enabled: true }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      submitLead(prisma, 'no-such-coach', { name: 'x', email: 'x@example.test', ...human }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
