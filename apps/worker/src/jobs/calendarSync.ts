import {
  calendarPorts,
  seal,
  sealKeyFromEnv,
  syncCalendars,
  unseal,
  type CalendarTokens,
} from '@kinetic/core';
import { defineJob } from './registry';

export const CALENDAR_SYNC = 'calendar.sync';
/** pg-boss cron: every five minutes (pushes go out quickly; busy times refresh every 15 minutes). */
export const CALENDAR_SYNC_CRON = '*/5 * * * *';

/** D-013 #11: pushes bookings to coaches' connected calendars and refreshes their busy times. */
export const calendarSyncJob = defineJob<object>({
  name: CALENDAR_SYNC,
  cron: CALENDAR_SYNC_CRON,
  async handle(_data, deps) {
    const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
    const ports = calendarPorts(process.env, appBaseUrl);
    if (Object.keys(ports).length === 0) return;
    // Without the sealing key no token can be opened; nothing to do (the web app refuses to connect without it).
    const key = sealKeyFromEnv(process.env);
    if (!key) return;
    const r = await syncCalendars(deps.prisma, {
      portFor: (p) => ports[p] ?? null,
      open: (sealed, ctx) => JSON.parse(unseal(key, sealed, ctx)) as CalendarTokens,
      seal: (tokens, ctx) => seal(key, JSON.stringify(tokens), ctx),
      appBaseUrl,
    });
    if (r.pushed + r.failed + r.busyRefreshed > 0) deps.logger.info(r, 'calendars synced');
  },
});
