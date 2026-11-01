import { apiHandler } from '@/server/api';
import { exerciseDemoPutRoute } from '@/server/routes/exercises';

export const PUT = apiHandler(exerciseDemoPutRoute);
