import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createNote, type NoteView } from '../history/notes';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getClientContext, setNotePinned, updateClientContext } from './context';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('client context card (PRD B7)', () => {
  it('coach fills in and clears fields; the audit holds field names only', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const ctx = await runAs(prisma, w.coach, (tx) =>
      updateClientContext(tx, w.coach, w.clientId, {
        goals: 'Run a 10k by March',
        motivation: '  Wants to keep up with their kids  ',
        equipmentNotes: 'Dumbbells to 20 kg, bands',
      }),
    );
    expect(ctx).toMatchObject({
      goals: 'Run a 10k by March',
      motivation: 'Wants to keep up with their kids',
      equipmentNotes: 'Dumbbells to 20 kg, bands',
      scheduleNotes: null,
    });
    const cleared = await runAs(prisma, w.coach, (tx) =>
      updateClientContext(tx, w.coach, w.clientId, { motivation: '' }),
    );
    expect(cleared.motivation).toBeNull();
    expect(cleared.goals).toBe('Run a 10k by March');
    const audits = await withSystem(
      (tx) =>
        tx.auditEvent.findMany({
          where: { objectId: w.clientId, action: 'client.context_updated' },
        }),
      prisma,
    );
    expect(JSON.stringify(audits)).not.toContain('kids');
    expect(audits[0]?.metadataJson).toEqual({ fields: 'goals,motivation,equipmentNotes' });
  });

  it('pins up to 3 notes, newest pin first; unpin frees a slot', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const notes: NoteView[] = [];
    for (const body of [
      'Bad left knee: no deep lunges',
      'Prefers morning sessions',
      'Vegetarian',
      'Fourth',
    ]) {
      notes.push(
        await runAs(prisma, w.coach, (tx) => createNote(tx, w.coach, w.clientId, { body })),
      );
    }
    for (const n of notes.slice(0, 3)) {
      await runAs(prisma, w.coach, (tx) => setNotePinned(tx, w.coach, n.id, true));
    }
    await expect(
      runAs(prisma, w.coach, (tx) => setNotePinned(tx, w.coach, notes[3]!.id, true)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const ctx = await runAs(prisma, w.coach, (tx) => getClientContext(tx, w.coach, w.clientId));
    expect(ctx.pinnedNotes).toHaveLength(3);
    await runAs(prisma, w.coach, (tx) => setNotePinned(tx, w.coach, notes[0]!.id, false));
    const after = await runAs(prisma, w.coach, (tx) =>
      setNotePinned(tx, w.coach, notes[3]!.id, true),
    );
    expect(after.pinnedNotes.map((n) => n.body)).toContain('Fourth');
    expect(after.pinnedNotes.map((n) => n.body)).not.toContain('Bad left knee: no deep lunges');
  });

  it('never reaches a client; validates length; other orgs read as not found', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newOrg(prisma);
    await expect(
      runAs(prisma, w.client, (tx) => getClientContext(tx, w.client, w.clientId)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      runAs(prisma, w.coach, (tx) =>
        updateClientContext(tx, w.coach, w.clientId, { preferences: 'x'.repeat(1001) }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { preferences: expect.any(Array) },
    });
    await expect(
      runAs(prisma, other.coach, (tx) => getClientContext(tx, other.coach, w.clientId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
