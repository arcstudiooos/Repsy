import { sendDueScheduledMessages } from '@repsy/core';
import { defineJob } from './registry';

export const SCHEDULED_MESSAGES = 'messages.scheduled';
/** pg-boss cron: every minute (PRD H5). */
export const SCHEDULED_MESSAGES_CRON = '* * * * *';

/** Sends the messages coaches scheduled for now or earlier. */
export const scheduledMessagesJob = defineJob<object>({
  name: SCHEDULED_MESSAGES,
  cron: SCHEDULED_MESSAGES_CRON,
  async handle(_data, deps) {
    const { sent, failed } = await sendDueScheduledMessages(deps.prisma);
    if (sent > 0 || failed > 0) deps.logger.info({ sent, failed }, 'scheduled messages sent');
  },
});
