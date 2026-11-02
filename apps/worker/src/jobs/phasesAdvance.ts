import { advancePhases } from '@kinetic/core';
import { defineJob } from './registry';

export const PHASES_ADVANCE = 'phases.advance';
/** pg-boss cron: hourly (PRD C17, J5). */
export const PHASES_ADVANCE_CRON = '23 * * * *';

/** Starts the next queued program phase for clients whose running program has finished. */
export const phasesAdvanceJob = defineJob<object>({
  name: PHASES_ADVANCE,
  cron: PHASES_ADVANCE_CRON,
  async handle(_data, deps) {
    const { started, flagged } = await advancePhases(deps.prisma);
    if (started > 0 || flagged > 0)
      deps.logger.info({ started, flagged }, 'program phases advanced');
  },
});
