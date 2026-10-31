import { apiHandler } from '@/server/api';
import { nutritionGetRoute } from '@/server/routes/nutrition';

export const GET = apiHandler(nutritionGetRoute);
