import { apiHandler } from '@/server/api';
import { mealPlanDeleteRoute, mealPlanPutRoute } from '@/server/routes/mealPlans';

export const PUT = apiHandler(mealPlanPutRoute);
export const DELETE = apiHandler(mealPlanDeleteRoute);
