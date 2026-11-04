import { apiHandler } from '@/server/api';
import {
  billingPackagesDeleteRoute,
  billingPackagesGetRoute,
  billingPackagesPostRoute,
} from '@/server/routes/billing';

export const GET = apiHandler(billingPackagesGetRoute);
export const POST = apiHandler(billingPackagesPostRoute);
export const DELETE = apiHandler(billingPackagesDeleteRoute);
