import { apiHandler } from '@/server/api';
import { sessionReadinessRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionReadinessRoute);
