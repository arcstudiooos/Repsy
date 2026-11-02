import { apiHandler } from '@/server/api';
import { clientMealPlanPutRoute } from '@/server/routes/mealPlans';

export const PUT = apiHandler(clientMealPlanPutRoute);
