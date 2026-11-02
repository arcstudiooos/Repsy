import { processClientEvents, runDueSteps } from '@kinetic/core';
import { defineJob } from './registry';

export const AUTOMATIONS = 'automations.run';
/** pg-boss cron: every 5 minutes (PRD J1-J3). */
export const AUTOMATIONS_CRON = '*/5 * * * *';

/** Starts runs from new client events, then runs the steps that are due. */
export const automationsJob = defineJob<object>({
  name: AUTOMATIONS,
  cron: AUTOMATIONS_CRON,
  async handle(_data, deps) {
    const started = await processClientEvents(deps.prisma);
    const { done, failed, waiting } = await runDueSteps(deps.prisma);
    if (started + done + failed + waiting > 0) {
      deps.logger.info({ started, done, failed, waiting }, 'automations ran');
    }
  },
});
