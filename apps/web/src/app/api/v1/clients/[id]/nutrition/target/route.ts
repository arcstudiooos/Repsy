import { apiHandler } from '@/server/api';
import { nutritionTargetRoute } from '@/server/routes/nutrition';

export const PUT = apiHandler(nutritionTargetRoute);
