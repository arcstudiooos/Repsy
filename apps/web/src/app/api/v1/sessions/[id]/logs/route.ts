import { apiHandler } from '@/server/api';
import { sessionLogsRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionLogsRoute);
