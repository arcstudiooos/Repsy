import { apiHandler } from '@/server/api';
import { reviewGetRoute } from '@/server/routes/review';

export const GET = apiHandler(reviewGetRoute);
