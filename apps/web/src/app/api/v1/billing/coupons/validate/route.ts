import { apiHandler } from '@/server/api';
import { billingCouponValidateRoute } from '@/server/routes/billing';

export const GET = apiHandler(billingCouponValidateRoute);
