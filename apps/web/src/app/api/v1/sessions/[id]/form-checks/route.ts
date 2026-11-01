import { apiHandler } from '@/server/api';
import { sessionFormCheckRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionFormCheckRoute);
