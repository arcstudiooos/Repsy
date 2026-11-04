import { apiHandler } from '@/server/api';
import { billingCouponsPostRoute } from '@/server/routes/billing';

export const POST = apiHandler(billingCouponsPostRoute);
