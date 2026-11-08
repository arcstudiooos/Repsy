import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { recordMedia } from '../media/media';
import { getSessionDetail } from './detail';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from './fixtures.test-helpers';
import { addFormCheck } from './formChecks';
import { startSession } from './lifecycle';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('form-check videos (PRD D10)', () => {
  it('a client adds a video to an exercise of a started workout; the coach sees it', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    const [session] = await sessionsOf(prisma, w.assignmentId);
    const video = (actor: typeof w.client, clientId: string, key: string) =>
      runAs(prisma, actor, (tx) =>
        recordMedia(tx, actor, {
          purpose: 'form_check',
          clientId,
          contentType: 'video/mp4',
          bytes: 100,
          key: `media/${org.orgId}/form_check/${key}`,
        }),
      );
    const mine = await video(w.client, w.clientId, 'a');
    await expect(
      runAs(prisma, w.client, (tx) =>
        addFormCheck(tx, w.client, session!.id, { mediaId: mine.id }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const started = await runAs(prisma, w.client, (tx) =>
      startSession(tx, w.client, session!.id, { now: NOW }),
    );
    const wve = started.workout.exercises[0]!.id;
    const added = await runAs(prisma, w.client, (tx) =>
      addFormCheck(tx, w.client, session!.id, { mediaId: mine.id, workoutVersionExerciseId: wve }),
    );
    expect(added).toMatchObject({ mediaId: mine.id, workoutVersionExerciseId: wve });
    const theirs = await video(other.client, other.clientId, 'b');
    await expect(
      runAs(prisma, w.client, (tx) =>
        addFormCheck(tx, w.client, session!.id, { mediaId: theirs.id }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const detail = await runAs(prisma, org.coach, (tx) =>
      getSessionDetail(tx, org.coach, session!.id, { now: NOW }),
    );
    expect(detail.formChecks).toEqual([added]);
  });
});
