import { apiHandler } from '@/server/api';
import { sessionSkipRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionSkipRoute);
