import { apiHandler } from '@/server/api';
import { sessionLogsReviseRoute, sessionLogsRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionLogsRoute);
export const PATCH = apiHandler(sessionLogsReviseRoute);
