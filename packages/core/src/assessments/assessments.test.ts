import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import type { ActorContext } from '../authz/actor';
import { recordMedia } from '../media/media';
import { addProgressPhoto } from '../media/progressPhotos';
import { decideDeletion } from '../admin/admin';
import { eraseClientData, requestDeletion } from '../privacy/deletion';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  addAssessmentPhoto,
  archiveAssessment,
  assignAssessment,
  clientAssessments,
  deleteAssessmentPhoto,
  listAssessments,
  nextDue,
  saveAssessment,
} from './assessments';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const NOW = new Date('2026-11-04T15:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
let k = 0;
const media = (actor: ActorContext, clientId: string) =>
  runAs(prisma, actor, (tx) =>
    recordMedia(tx, actor, {
      purpose: 'progress_photo',
      clientId,
      contentType: 'image/jpeg',
      bytes: 10,
      key: `media/test/assess-${Date.now()}-${k++}`,
    }),
  );

describe('assessment schedule (PRD E5)', () => {
  it('is due on the start date, then every N weeks after the latest photo', () => {
    expect(nextDue('2026-11-04', null, 4)).toBe('2026-11-04');
    expect(nextDue('2026-11-04', '2026-11-06', 4)).toBe('2026-12-04');
    expect(nextDue('2026-11-04', '2026-11-06', 0)).toBeNull();
  });
});

describe('assessments (PRD E5)', () => {
  it('asks the client for a photo, then for a retest; the coach sees them all', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveAssessment(tx, org.coach, { title: 'Posture', guide: 'grid' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const { id } = await runAs(prisma, org.coach, (tx) =>
      saveAssessment(tx, org.coach, {
        title: 'Standing posture (side)',
        instructions: 'Side-on, arms relaxed, feet hip-width.',
        guide: 'plumb_line',
        everyWeeks: 4,
      }),
    );
    await runAs(prisma, org.coach, (tx) =>
      assignAssessment(tx, org.coach, { clientId: w.clientId, assessmentId: id }, { now: NOW }),
    );
    const again = await runAs(prisma, org.coach, (tx) =>
      assignAssessment(tx, org.coach, { clientId: w.clientId, assessmentId: id }, { now: NOW }),
    );
    expect(again.created).toBe(false);

    const [a] = await runAs(prisma, w.client, (tx) => clientAssessments(tx, w.client, null, NOW));
    expect(a).toMatchObject({ title: 'Standing posture (side)', due: true, dueOn: '2026-11-04' });

    const m1 = await media(w.client, w.clientId);
    await runAs(prisma, w.client, (tx) =>
      addAssessmentPhoto(tx, w.client, { clientAssessmentId: a!.id, mediaId: m1.id }, { now: NOW }),
    );
    // The same file can't also be a progress photo.
    await expect(
      runAs(prisma, w.client, (tx) =>
        addProgressPhoto(tx, w.client, { mediaId: m1.id, pose: 'side' }, { now: NOW }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const after = await runAs(prisma, w.client, (tx) => clientAssessments(tx, w.client, null, NOW));
    expect(after[0]).toMatchObject({ due: false, dueOn: '2026-12-02' });
    const later = await runAs(prisma, org.coach, (tx) =>
      clientAssessments(tx, org.coach, w.clientId, days(28)),
    );
    expect(later[0]).toMatchObject({ due: true });

    const m2 = await media(org.coach, w.clientId);
    await runAs(prisma, org.coach, (tx) =>
      addAssessmentPhoto(
        tx,
        org.coach,
        { clientAssessmentId: a!.id, mediaId: m2.id },
        { now: days(28) },
      ),
    );
    const both = await runAs(prisma, org.coach, (tx) =>
      clientAssessments(tx, org.coach, w.clientId, days(28)),
    );
    expect(both[0]!.photos.map((p) => p.takenOn)).toEqual(['2026-12-02', '2026-11-04']);

    // Another client can't add to or delete from it.
    const other = await newClientWorld(prisma, org);
    const m3 = await media(other.client, other.clientId);
    await expect(
      runAs(prisma, other.client, (tx) =>
        addAssessmentPhoto(tx, other.client, { clientAssessmentId: a!.id, mediaId: m3.id }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, other.client, (tx) =>
        deleteAssessmentPhoto(tx, other.client, both[0]!.photos[0]!.id),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await runAs(prisma, w.client, (tx) =>
      deleteAssessmentPhoto(tx, w.client, both[0]!.photos[0]!.id),
    );
    const erased = await withSystem(
      (tx) => tx.mediaFile.findUniqueOrThrow({ where: { id: m2.id }, select: { erasedAt: true } }),
      prisma,
    );
    expect(erased.erasedAt).not.toBeNull();

    expect(await runAs(prisma, org.coach, (tx) => listAssessments(tx, org.coach))).toMatchObject([
      { title: 'Standing posture (side)', assigned: 1 },
    ]);
    await runAs(prisma, org.coach, (tx) => archiveAssessment(tx, org.coach, id));
    expect(
      await runAs(prisma, w.client, (tx) => clientAssessments(tx, w.client, null, NOW)),
    ).toEqual([]);
  });

  it('erasing a client removes their assessments and marks the files', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const { id } = await runAs(prisma, org.coach, (tx) =>
      saveAssessment(tx, org.coach, { title: 'Overhead squat', everyWeeks: 0 }),
    );
    const ca = await runAs(prisma, org.coach, (tx) =>
      assignAssessment(tx, org.coach, { clientId: w.clientId, assessmentId: id }, { now: NOW }),
    );
    const m = await media(w.client, w.clientId);
    await runAs(prisma, w.client, (tx) =>
      addAssessmentPhoto(tx, w.client, { clientAssessmentId: ca.id, mediaId: m.id }, { now: NOW }),
    );
    const [done] = await runAs(prisma, w.client, (tx) =>
      clientAssessments(tx, w.client, null, days(400)),
    );
    expect(done).toMatchObject({ dueOn: null, due: false });
    const adminId = await withSystem(
      async (tx) =>
        (
          await tx.user.create({
            data: { email: `admin-${Date.now()}@example.test`, name: 'A', isPlatformAdmin: true },
          })
        ).id,
      prisma,
    );
    const r = await runAs(prisma, w.client, (tx) => requestDeletion(tx, w.client));
    await withSystem(
      (tx) =>
        decideDeletion(tx, { userId: adminId, isPlatformAdmin: true }, r.id, { action: 'verify' }),
      prisma,
    );
    await withSystem((tx) => eraseClientData(tx, r.id, NOW), prisma);
    const left = await withSystem(
      async (tx) => ({
        rows: await tx.clientAssessment.count({ where: { clientId: w.clientId } }),
        file: await tx.mediaFile.findUniqueOrThrow({ where: { id: m.id } }),
      }),
      prisma,
    );
    expect(left.rows).toBe(0);
    expect(left.file.erasedAt).not.toBeNull();
  });
});
