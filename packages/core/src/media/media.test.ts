import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  mediaForDownload,
  prepareUpload,
  purgeErasedMedia,
  recordMedia,
  uploadOwner,
} from './media';
import { addProgressPhoto, deleteProgressPhoto, listProgressPhotos } from './progressPhotos';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c]),
  Buffer.from('Exif\0\0GPS!', 'latin1'),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xff, 0xd9]),
]);

describe('uploads and progress photos (PRD E3; D-011 #5)', () => {
  it('checks the type, strips the image, and keeps photos to the client and their coaches', async () => {
    expect(() => prepareUpload('progress_photo', Buffer.from('%PDF-1.4'))).toThrow();
    const file = prepareUpload('progress_photo', JPEG);
    expect(file.contentType).toBe('image/jpeg');
    expect(file.bytes.toString('latin1')).not.toContain('GPS');

    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, org);
    // A client always uploads for themselves, whatever they claim.
    expect(
      await runAs(prisma, w.client, (tx) =>
        uploadOwner(tx, w.client, 'progress_photo', other.clientId),
      ),
    ).toBe(w.clientId);
    const media = await runAs(prisma, w.client, (tx) =>
      recordMedia(tx, w.client, {
        purpose: 'progress_photo',
        clientId: w.clientId,
        contentType: file.contentType,
        bytes: file.bytes.length,
        key: `media/${org.orgId}/progress_photo/t1`,
      }),
    );
    const photo = await runAs(prisma, w.client, (tx) =>
      addProgressPhoto(tx, w.client, { mediaId: media.id, pose: 'side', takenOn: '2026-11-01' }),
    );
    expect(
      await runAs(prisma, org.coach, (tx) => listProgressPhotos(tx, org.coach, w.clientId)),
    ).toEqual([photo]);
    expect(
      await runAs(prisma, org.coach, (tx) => mediaForDownload(tx, org.coach, media.id)),
    ).toMatchObject({
      contentType: 'image/jpeg',
    });
    await expect(
      runAs(prisma, other.client, (tx) => mediaForDownload(tx, other.client, media.id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Someone else's upload can't be attached.
    await expect(
      runAs(prisma, other.client, (tx) =>
        addProgressPhoto(tx, other.client, { mediaId: media.id, pose: 'front' }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await runAs(prisma, w.client, (tx) => deleteProgressPhoto(tx, w.client, photo.id));
    expect(await runAs(prisma, w.client, (tx) => listProgressPhotos(tx, w.client))).toEqual([]);
    const deleted: string[] = [];
    expect(
      await purgeErasedMedia(prisma, { deleteMany: async (keys) => void deleted.push(...keys) }),
    ).toEqual({ purged: 1 });
    expect(deleted).toEqual([`media/${org.orgId}/progress_photo/t1`]);
    expect(await withSystem((tx) => tx.mediaFile.count({ where: { id: media.id } }), prisma)).toBe(
      0,
    );
  });
});
