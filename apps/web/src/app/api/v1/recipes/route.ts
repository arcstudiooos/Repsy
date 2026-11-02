import { apiHandler } from '@/server/api';
import { recipesPostRoute } from '@/server/routes/mealPlans';

export const POST = apiHandler(recipesPostRoute);
