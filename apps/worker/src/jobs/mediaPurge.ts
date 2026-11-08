import { purgeErasedMedia } from '@repsy/core';
import { createStorage, type StoragePort } from '@repsy/storage';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineJob } from './registry';

export const MEDIA_PURGE = 'media.purge';
/** pg-boss cron: hourly (D-011 #5). */
export const MEDIA_PURGE_CRON = '41 * * * *';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let storage: StoragePort | undefined;

/** Deletes the stored objects of erased and abandoned uploads, then their rows. */
export const mediaPurgeJob = defineJob<object>({
  name: MEDIA_PURGE,
  cron: MEDIA_PURGE_CRON,
  async handle(_data, deps) {
    storage ??= createStorage(process.env, repoRoot);
    const { purged } = await purgeErasedMedia(deps.prisma, storage);
    if (purged > 0) deps.logger.info({ purged }, 'media purged');
  },
});
