import { apiHandler } from '@/server/api';
import { sessionStartRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionStartRoute);
