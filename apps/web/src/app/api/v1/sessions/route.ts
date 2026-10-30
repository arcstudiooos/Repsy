import { apiHandler } from '@/server/api';
import { sessionsListRoute } from '@/server/routes/workoutSessions';

export const GET = apiHandler(sessionsListRoute);
