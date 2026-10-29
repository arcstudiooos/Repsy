import { apiHandler } from '@/server/api';
import { exercisesListRoute, exercisesPostRoute } from '@/server/routes/exercises';

export const GET = apiHandler(exercisesListRoute);
export const POST = apiHandler(exercisesPostRoute);
