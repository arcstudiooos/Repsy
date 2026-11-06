import { purgeOldAiConversations } from '@kinetic/core';
import { defineJob } from './registry';

export const AI_PURGE = 'ai.purge';
/** pg-boss cron: daily at 03:17 UTC. */
export const AI_PURGE_CRON = '17 3 * * *';

/** PRD I15: deletes AI assistant conversations untouched for 90 days. */
export const aiPurgeJob = defineJob<object>({
  name: AI_PURGE,
  cron: AI_PURGE_CRON,
  async handle(_data, deps) {
    const { purged } = await purgeOldAiConversations(deps.prisma);
    if (purged > 0) deps.logger.info({ purged }, 'ai conversations purged');
  },
});
