import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { applyPause } from '../clients/pause';
import { DomainError } from '../errors';
import { completeSession } from '../sessions/lifecycle';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { createNote, deleteNote, listNotes, updateNote } from './notes';
import { getClientTimeline } from './timeline';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

describe('internal notes', () => {
  it('coach CRUD; only the author edits or deletes; clients are FORBIDDEN', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) => createNote(tx, w.coach, w.clientId, { body: ' ' })),
      ),
    ).toBe('VALIDATION');
    const note = await runAs(prisma, w.coach, (tx) =>
      createNote(tx, w.coach, w.clientId, { body: 'Prefers morning sessions' }),
    );
    expect(note).toMatchObject({ mine: true, body: 'Prefers morning sessions' });
    const edited = await runAs(prisma, w.coach, (tx) =>
      updateNote(tx, w.coach, note.id, { body: 'Prefers 7am sessions' }),
    );
    expect(edited.body).toBe('Prefers 7am sessions');

    // A second coach in the organization reads it but can't change it.
    const other = await withSystem(async (tx) => {
      const u = await tx.user.create({
        data: { email: `co-${crypto.randomUUID()}@example.test`, name: 'Co' },
      });
      await tx.membership.create({
        data: { userId: u.id, organizationId: w.orgId, role: 'coach' },
      });
      return u.id;
    }, prisma);
    const coach2 = { ...w.coach, userId: other, role: 'coach' as const };
    const seen = await runAs(prisma, coach2, (tx) => listNotes(tx, coach2, w.clientId));
    expect(seen[0]).toMatchObject({ id: note.id, mine: false });
    expect(
      await codeOf(runAs(prisma, coach2, (tx) => updateNote(tx, coach2, note.id, { body: 'x' }))),
    ).toBe('FORBIDDEN');
    expect(await codeOf(runAs(prisma, coach2, (tx) => deleteNote(tx, coach2, note.id)))).toBe(
      'FORBIDDEN',
    );

    expect(await codeOf(runAs(prisma, w.client, (tx) => listNotes(tx, w.client, w.clientId)))).toBe(
      'FORBIDDEN',
    );
    const outsider = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, outsider.coach, (tx) => listNotes(tx, outsider.coach, w.clientId)),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(runAs(prisma, outsider.coach, (tx) => deleteNote(tx, outsider.coach, note.id))),
    ).toBe('NOT_FOUND');

    await runAs(prisma, w.coach, (tx) => deleteNote(tx, w.coach, note.id));
    expect(await runAs(prisma, w.coach, (tx) => listNotes(tx, w.coach, w.clientId))).toEqual([]);
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: note.id } }),
      prisma,
    );
    expect(audits.map((a) => a.action)).toEqual([
      'internal_note.created',
      'internal_note.updated',
      'internal_note.deleted',
    ]);
    expect(JSON.stringify(audits)).not.toContain('morning');
  });
});

describe('client timeline', () => {
  it('lists assignment, sessions, pause and private notes newest first', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [first] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(
        tx,
        w.client,
        first!.id,
        { idempotencyKey: crypto.randomUUID() },
        { now: NOW },
      ),
    );
    await runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate: '2026-11-20', resumeLocalDate: '2026-11-27' },
        { now: NOW },
      ),
    );
    await runAs(prisma, w.coach, (tx) =>
      createNote(tx, w.coach, w.clientId, { body: 'Knee feels better' }),
    );
    const events = await runAs(prisma, w.coach, (tx) => getClientTimeline(tx, w.coach, w.clientId));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('assignment');
    expect(kinds).toContain('session');
    expect(kinds).toContain('pause');
    const note = events.find((e) => e.kind === 'note');
    expect(note).toMatchObject({ private: true, detail: 'Knee feels better' });
    expect(events.find((e) => e.kind === 'session')?.title).toBe('Completed: W1D1');
    const ats = events.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(
      await codeOf(runAs(prisma, w.client, (tx) => getClientTimeline(tx, w.client, w.clientId))),
    ).toBe('FORBIDDEN');
  });
});
