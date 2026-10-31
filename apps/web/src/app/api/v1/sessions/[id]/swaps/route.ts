import { apiHandler } from '@/server/api';
import { sessionSwapRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionSwapRoute);
