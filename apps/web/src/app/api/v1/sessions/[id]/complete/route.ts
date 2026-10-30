import { apiHandler } from '@/server/api';
import { sessionCompleteRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionCompleteRoute);
