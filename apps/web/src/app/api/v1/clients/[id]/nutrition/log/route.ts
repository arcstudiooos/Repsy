import { apiHandler } from '@/server/api';
import { nutritionLogRoute } from '@/server/routes/nutrition';

export const PUT = apiHandler(nutritionLogRoute);
