import { apiHandler } from '@/server/api';
import { extraWorkoutStartRoute } from '@/server/routes/workoutSessions';

export const POST = apiHandler(extraWorkoutStartRoute);
