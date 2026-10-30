import { apiHandler } from '@/server/api';
import { sessionGetRoute } from '@/server/routes/workoutSessions';

export const GET = apiHandler(sessionGetRoute);
