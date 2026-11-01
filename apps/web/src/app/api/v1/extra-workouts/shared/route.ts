import { apiHandler } from '@/server/api';
import { extraWorkoutSharedRoute } from '@/server/routes/workoutSessions';

export const GET = apiHandler(extraWorkoutSharedRoute);
