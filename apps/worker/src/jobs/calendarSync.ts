import { googleOAuthConfig, syncPendingBookings } from '@kinetic/core';
import { defineJob } from './registry';

export const CALENDAR_SYNC = 'calendar.sync';
/** pg-boss cron: every 2 minutes. */
export const CALENDAR_SYNC_CRON = '*/2 * * * *';

/** PRD K10: pushes new bookings to coaches' Google calendars and removes cancelled ones. */
export const calendarSyncJob = defineJob<object>({
  name: CALENDAR_SYNC,
  cron: CALENDAR_SYNC_CRON,
  async handle(_data, deps) {
    const config = googleOAuthConfig();
    if (!config) return;
    const stats = await syncPendingBookings(deps.prisma, config);
    if (stats.pushed + stats.removed + stats.failed > 0) deps.logger.info(stats, 'calendar synced');
  },
});
