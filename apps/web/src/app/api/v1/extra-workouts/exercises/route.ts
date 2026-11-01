import { apiHandler } from '@/server/api';
import { extraWorkoutExercisesRoute } from '@/server/routes/workoutSessions';

export const GET = apiHandler(extraWorkoutExercisesRoute);
