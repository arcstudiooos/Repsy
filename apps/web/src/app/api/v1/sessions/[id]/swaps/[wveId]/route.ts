import { apiHandler } from '@/server/api';
import { sessionSwapDeleteRoute } from '@/server/routes/workoutSessions';

export const DELETE = apiHandler(sessionSwapDeleteRoute);
