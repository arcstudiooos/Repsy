import { apiHandler } from '@/server/api';
import { revenueGetRoute } from '@/server/routes/billing';

export const GET = apiHandler(revenueGetRoute);
