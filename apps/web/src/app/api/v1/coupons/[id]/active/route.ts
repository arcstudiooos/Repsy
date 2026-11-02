import { apiHandler } from '@/server/api';
import { couponActiveRoute } from '@/server/routes/billing';

export const PUT = apiHandler(couponActiveRoute);
