import { apiHandler } from '@/server/api';
import { couponsGetRoute, couponsPostRoute } from '@/server/routes/billing';

export const GET = apiHandler(couponsGetRoute);
export const POST = apiHandler(couponsPostRoute);
