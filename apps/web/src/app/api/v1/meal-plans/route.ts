import { apiHandler } from '@/server/api';
import { mealPlansPostRoute } from '@/server/routes/mealPlans';

export const POST = apiHandler(mealPlansPostRoute);
