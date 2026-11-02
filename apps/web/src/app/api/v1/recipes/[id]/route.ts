import { apiHandler } from '@/server/api';
import { recipeDeleteRoute, recipePutRoute } from '@/server/routes/mealPlans';

export const PUT = apiHandler(recipePutRoute);
export const DELETE = apiHandler(recipeDeleteRoute);
