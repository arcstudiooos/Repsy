import { apiHandler } from '@/server/api';
import { scheduledListRoute, schedulePostRoute } from '@/server/routes/scheduledMessages';

export const GET = apiHandler(scheduledListRoute);
export const POST = apiHandler(schedulePostRoute);
