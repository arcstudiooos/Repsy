import { apiHandler } from '@/server/api';
import { sessionRescheduleRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(sessionRescheduleRoute);
