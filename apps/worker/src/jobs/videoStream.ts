import { processVideoStreams, streamConfig } from '@repsy/core';
import { createStorage, type StoragePort } from '@repsy/storage';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineJob } from './registry';

export const VIDEO_STREAM = 'video.stream';
/** pg-boss cron: every minute. */
export const VIDEO_STREAM_CRON = '* * * * *';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let storage: StoragePort | undefined;

/** PRD L11: sends coach demo videos to Cloudflare Stream and records the adaptive HLS manifest. */
export const videoStreamJob = defineJob<object>({
  name: VIDEO_STREAM,
  cron: VIDEO_STREAM_CRON,
  async handle(_data, deps) {
    const config = streamConfig();
    if (!config) return;
    storage ??= createStorage(process.env, repoRoot);
    const stats = await processVideoStreams(deps.prisma, storage, config);
    if (stats.sent + stats.ready + stats.removed + stats.failed > 0) {
      deps.logger.info(stats, 'video streams processed');
    }
  },
});
