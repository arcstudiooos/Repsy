import { apiHandler } from '@/server/api';
import { clientCalendarRoute } from '@/server/routes/workoutSessions';

export const GET = apiHandler(clientCalendarRoute);
